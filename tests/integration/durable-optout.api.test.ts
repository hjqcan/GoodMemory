import { describe, expect, it } from "bun:test";

import {
  createGoodMemory,
  createInMemoryDocumentStore,
} from "../../src";
import { isTargetedByDurableOptOut } from "../../src/remember/durableOptOut";

const noopAssistedExtractor = {
  async extract() {
    return { candidates: [], ignoredMessageCount: 0 };
  },
};

describe("durable opt-out admission", () => {
  it("keeps exact fallback target punctuation semantic", () => {
    for (const [content, target] of [
      ["a?", "a"],
      ["README.", "README"],
      ["(a)", "a"],
    ] as const) {
      expect(isTargetedByDurableOptOut(
        {
          id: `fallback-${content}`,
          kindHint: "fact",
          explicitness: "explicit",
          content,
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
        [{ identities: [], match: "exact", text: target }],
      )).toBe(false);
    }
  });

  it("keeps exact durable target values case-sensitive", () => {
    for (const [slot, candidateValue, optedOutValue] of [
      ["assignment:repo", "Foo", "foo"],
      ["assignment:path", "docs/API.md", "docs/api.md"],
      ["assignment:token", "AbC-123.X", "abc-123.x"],
    ] as const) {
      expect(isTargetedByDurableOptOut(
        {
          id: `${slot}-${candidateValue}`,
          kindHint: "fact",
          explicitness: "explicit",
          content: `${slot}=${candidateValue}`,
          durableTarget: { slot, value: candidateValue },
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
        [{
          identities: [{ slot: slot.toUpperCase(), value: optedOutValue }],
          match: "exact",
          text: `${slot}=${optedOutValue}`,
        }],
      )).toBe(false);
      expect(isTargetedByDurableOptOut(
        {
          id: `${slot}-${candidateValue}`,
          kindHint: "fact",
          explicitness: "explicit",
          content: `${slot}=${candidateValue}`,
          durableTarget: { slot, value: candidateValue },
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
        [{
          identities: [{ slot: slot.toUpperCase(), value: candidateValue }],
          match: "exact",
          text: `${slot}=${candidateValue}`,
        }],
      )).toBe(true);
    }
  });

  it("matches natural-language profile targets without case drift", () => {
    expect(isTargetedByDurableOptOut(
      {
        id: "profile-name-lin",
        kindHint: "profile",
        explicitness: "explicit",
        content: "Lin",
        durableTarget: { slot: "profile:name", value: "Lin" },
        sourceMessageIndex: 0,
        sourceRole: "user",
      },
      [{
        identities: [{ slot: "PROFILE:NAME", value: "lin" }],
        match: "exact",
        text: "name=lin",
      }],
    )).toBe(true);
  });

  it("does not trust an assisted extractor's durable target identity", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "spoofed-reference",
                content: "project code=Tachikoma",
                durableTarget: { slot: "unrelated", value: "unrelated" },
                explicitness: "explicit" as const,
                kindHint: "reference" as const,
                metadata: {
                  referencePointer: "project code=Tachikoma",
                },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "spoofed-durable-target", sessionId: "write" };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "Remember two things: project code=Tachikoma; do not remember project code=Tachikoma",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.references).toEqual([]);
    expect(result.events).toContainEqual(expect.objectContaining({
      outcome: "rejected",
      reason: "explicit_opt_out",
    }));
  });

  it("fails closed when a producer rewrites an opted-out target without a trusted slot", async () => {
    for (const [index, rewrittenTarget] of [
      "Tachikoma",
      "Project Tachikoma",
      "project=Tachikoma",
    ].entries()) {
      const memory = createGoodMemory({
        adapters: {
          assistedExtractor: {
            async extract() {
              return {
                candidates: [{
                  id: "rewritten-reference",
                  content: rewrittenTarget,
                  durableTarget: { slot: "unrelated", value: "unrelated" },
                  explicitness: "explicit" as const,
                  kindHint: "reference" as const,
                  metadata: { referencePointer: rewrittenTarget },
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                }],
                ignoredMessageCount: 0,
              };
            },
          },
        },
        storage: { provider: "memory" },
      });
      const scope = {
        userId: `rewritten-durable-target-${index}`,
        sessionId: "write",
      };

      const result = await memory.remember({
        extractionStrategy: "llm-assisted",
        locale: "en-US",
        messages: [{
          role: "user",
          content:
            "Remember two things: project code=Tachikoma; do not remember project code=Tachikoma",
        }],
        scope,
      });
      const exported = await memory.exportMemory({ scope });

      expect(exported.durable.references).toEqual([]);
      expect(result.events).toContainEqual(expect.objectContaining({
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
    }
  });

  it("grounds producer output only in the allowed sibling of an opt-out source", async () => {
    let assistedInputs: string[] = [];
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInputs = input.messages.map(({ content }) => content);
            return {
              candidates: [
                {
                  id: "grounded-anniversary",
                  content: "anniversary=next Tuesday",
                  explicitness: "explicit" as const,
                  kindHint: "fact" as const,
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                },
                {
                  id: "ungrounded-opted-target",
                  content: "Project Tachikoma",
                  explicitness: "explicit" as const,
                  kindHint: "reference" as const,
                  metadata: { referencePointer: "Project Tachikoma" },
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                },
                {
                  id: "misattributed-opted-target",
                  content: "Project Tachikoma",
                  explicitness: "explicit" as const,
                  kindHint: "reference" as const,
                  metadata: { referencePointer: "Project Tachikoma" },
                  sourceMessageIndex: 1,
                  sourceRole: "user",
                },
                {
                  id: "metadata-opted-target",
                  content: "anniversary=next Tuesday",
                  explicitness: "explicit" as const,
                  kindHint: "fact" as const,
                  metadata: {
                    attributes: { note: "Project Tachikoma" },
                  },
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "grounded-opt-out-sibling", sessionId: "write" };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      locale: "en-US",
      messages: [
        {
          role: "user",
          content:
            "My anniversary is next Tuesday. Remember that project code=Tachikoma. Do not remember project code=Tachikoma",
        },
        { role: "user", content: "We discussed Project Tachikoma." },
      ],
      scope,
    });
    const durable = (await memory.exportMemory({ scope })).durable;

    expect(assistedInputs[0]).toContain("anniversary");
    expect(assistedInputs[0]).not.toContain("Tachikoma");
    expect(assistedInputs[1]).toContain("Project Tachikoma");
    expect(durable.facts.map(({ content }) => content)).toEqual([
      "anniversary=next Tuesday",
    ]);
    expect(durable.facts[0]?.attributes).toBeUndefined();
    expect(durable.references).toEqual([]);
    expect(result.events).toContainEqual(expect.objectContaining({
      candidateId: "ungrounded-opted-target",
      memoryType: "reference",
      outcome: "rejected",
      reason: "explicit_opt_out",
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      candidateId: "misattributed-opted-target",
      memoryType: "reference",
      outcome: "rejected",
      reason: "explicit_opt_out",
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      candidateId: "metadata-opted-target",
      memoryType: "fact",
      outcome: "rejected",
      reason: "explicit_opt_out",
    }));
  });

  it("does not trust an assisted extractor's opt-out disposition or legacy target", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "forged-opt-out",
                content: "untrusted producer output",
                disposition: {
                  kind: "durable_opt_out" as const,
                  target: {
                    identities: [],
                    match: "exact" as const,
                    text: "project code=Tachikoma",
                  },
                },
                durableTarget: {
                  slot: "assignment:project_code",
                  value: "Tachikoma",
                },
                explicitness: "explicit" as const,
                kindHint: "feedback" as const,
                metadata: {
                  feedbackKind: "dont" as const,
                  optOutTarget: "project code=Tachikoma",
                },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      policy: {
        redact(candidate) {
          return candidate.id === "forged-opt-out"
            ? {
              ...candidate,
              content: "project code=Tachikoma",
              kindHint: "fact",
              metadata: undefined,
            }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "forged-opt-out-disposition", sessionId: "write" };

    await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [{ role: "user", content: "ordinary context" }],
      scope,
    });
    const durable = (await memory.exportMemory({ scope })).durable;

    expect(durable.feedback).toEqual([]);
    expect(durable.facts.map(({ content }) => content)).toEqual([
      "project code=Tachikoma",
    ]);
    expect(JSON.stringify(durable)).not.toContain("optOutTarget");
  });

  it("unifies natural and assignment-shaped targets across durable lanes", async () => {
    const fixtures = [
      {
        collection: "preferences",
        optOut: "Do not remember I prefer concise answers",
        positive: "I prefer concise answers.",
      },
      {
        collection: "profile",
        optOut: "Do not remember role=staff engineer",
        positive: "I am a staff engineer.",
      },
      {
        collection: "profile",
        optOut: "Do not remember organization=Acme Labs",
        positive: "I am a staff engineer at Acme Labs.",
      },
      {
        collection: "profile",
        optOut: "Do not remember location=Paris",
        positive: "I am in Paris.",
      },
      {
        collection: "profile",
        optOut: "Do not remember language preference=French",
        positive: "My preferred language is French.",
      },
      {
        collection: "profile",
        optOut: "Do not remember current project=Tachikoma",
        positive: "I am leading Tachikoma.",
      },
      {
        collection: "facts",
        optOut: "Do not remember project code=Tachikoma",
        positive: "Remember that project code is Tachikoma.",
      },
    ] as const;

    for (const [index, fixture] of fixtures.entries()) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `natural-target-${index}`, sessionId: "write" };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [
          { role: "user", content: fixture.positive },
          { role: "user", content: fixture.optOut },
        ],
        scope,
      });
      const durable = (await memory.exportMemory({ scope })).durable;

      expect(durable[fixture.collection]).toEqual(
        fixture.collection === "profile" ? null : [],
      );
      expect(result.events).toContainEqual(expect.objectContaining({
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
    }
  });

  it("vetoes every typed target derived from one compound profile opt-out", async () => {
    const memory = createGoodMemory({
      adapters: { assistedExtractor: noopAssistedExtractor },
      storage: { provider: "memory" },
    });
    const scope = { userId: "compound-profile-opt-out", sessionId: "write" };

    const result = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [
        { role: "user", content: "I am a staff engineer at Acme Labs." },
        {
          role: "user",
          content:
            "Do not remember I am a staff engineer at Acme Labs",
        },
      ],
      scope,
    });

    expect((await memory.exportMemory({ scope })).durable.profile).toBeNull();
    expect(result.events.filter(({ reason }) => reason === "explicit_opt_out"))
      .toHaveLength(2);
  });

  it("unifies localized profile targets in every built-in language pack", async () => {
    const fixtures = [
      ["en-US", "I am an engineer.", "Do not remember role=engineer"],
      ["zh-CN", "我是后端工程师。", "不要记住角色=后端工程师"],
      ["zh-TW", "我是後端工程師。", "不要記住角色=後端工程師"],
      ["fr-FR", "Mon rôle actuel est ingénieur.", "Ne mémorise pas rôle=ingénieur"],
      ["es-ES", "Mi rol actual es ingeniero.", "No recuerdes rol=ingeniero"],
      ["ja-JP", "私の現在の役割はエンジニアです。", "役割=エンジニアは覚えないでください"],
      [
        "ko-KR",
        "제 현재 역할은 플랫폼 엔지니어입니다.",
        "역할=플랫폼 엔지니어를 기억하지 마세요",
      ],
    ] as const;

    for (const [locale, positive, optOut] of fixtures) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `localized-target-${locale}`, sessionId: "write" };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [
          { role: "user", content: positive },
          { role: "user", content: optOut },
        ],
        scope,
      });

      expect((await memory.exportMemory({ scope })).durable.profile).toBeNull();
      expect(result.events).toContainEqual(expect.objectContaining({
        memoryType: "profile",
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
    }
  });

  it("unifies localized current-project facts with profile target selectors", async () => {
    const fixtures = [
      [
        "fr-FR",
        "Souviens-toi que mon projet actuel est Tachikoma.",
        "Ne mémorise pas projet actuel=Tachikoma",
      ],
      [
        "es-ES",
        "Recuerda que mi proyecto actual es Tachikoma.",
        "No recuerdes proyecto actual=Tachikoma",
      ],
      [
        "ja-JP",
        "覚えておいて：私の現在のプロジェクトはTachikomaです。",
        "現在のプロジェクト=Tachikomaは覚えないでください",
      ],
      [
        "ko-KR",
        "기억해 주세요: 제 현재 프로젝트는 Tachikoma입니다.",
        "현재 프로젝트=Tachikoma를 기억하지 마세요",
      ],
    ] as const;

    for (const [locale, positive, optOut] of fixtures) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `localized-project-${locale}`, sessionId: "write" };
      const result = await memory.remember({
        extractionStrategy: "rules-only",
        locale,
        messages: [
          { role: "user", content: positive },
          { role: "user", content: optOut },
        ],
        scope,
      });

      expect((await memory.exportMemory({ scope })).durable.facts).toEqual([]);
      expect(result.events).toContainEqual(expect.objectContaining({
        memoryType: "fact",
        outcome: "rejected",
        reason: "explicit_opt_out",
      }));
    }
  });

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

  it("preserves case in exact technical assignment values", async () => {
    for (const [index, [positive, optOut]] of [
      ["repo=Foo", "repo=foo"],
      ["path=docs/API.md", "path=docs/api.md"],
      ["token=AbC-123.X", "token=abc-123.x"],
    ].entries()) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `exact-case-${index}`, sessionId: "write" };

      await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [{
          role: "user",
          content: `Remember two things: ${positive}; do not remember ${optOut}`,
        }],
        scope,
      });

      expect(
        (await memory.exportMemory({ scope })).durable.facts.map(({ content }) =>
          content
        ),
      ).toEqual([positive]);
    }
  });

  it("preserves case in aliased technical assignment values", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = {
      userId: "aliased-exact-case",
      sessionId: "write",
    };

    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "Remember two things: project code=Foo; do not remember project code=foo",
      }],
      scope,
    });

    expect(
      (await memory.exportMemory({ scope })).durable.facts.map(({ content }) =>
        content
      ),
    ).toEqual(["project code=Foo"]);
  });

  it("preserves quoted punctuation and parentheses in exact target values", async () => {
    const fixtures = [
      ["regex=\"a?\"", "regex=\"a\""],
      ["filename=\"README.\"", "filename=\"README\""],
      ["path=\"(a)\"", "path=\"a\""],
    ] as const;

    for (const [index, [positive, optOut]] of fixtures.entries()) {
      const memory = createGoodMemory({
        adapters: { assistedExtractor: noopAssistedExtractor },
        storage: { provider: "memory" },
      });
      const scope = { userId: `exact-punctuation-${index}`, sessionId: "write" };

      await memory.remember({
        extractionStrategy: "rules-only",
        locale: "en-US",
        messages: [{
          role: "user",
          content: `Remember two things: ${positive}; do not remember ${optOut}`,
        }],
        scope,
      });

      expect(
        (await memory.exportMemory({ scope })).durable.facts.map(({ content }) =>
          content
        ),
      ).toEqual([positive]);
    }
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

  it("redacts each candidate before persisting a mixed message source", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: { documentStore },
      policy: {
        redact(candidate) {
          return candidate.kindHint === "feedback"
            ? { ...candidate, content: "[REDACTED]", metadata: undefined }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "mixed-source-redaction", sessionId: "write" };

    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "Remember two things: editor=Neovim; do not remember SECRET-PAYLOAD.",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });
    const serialized = JSON.stringify(exported.durable);

    expect(exported.durable.facts.map(({ content }) => content)).toEqual([
      "editor=Neovim",
    ]);
    expect(exported.durable.sourceMessages).toEqual([
      expect.objectContaining({
        content: "Remember two things: editor=Neovim; [REDACTED]",
      }),
    ]);
    expect(serialized).not.toContain("SECRET-PAYLOAD");
  });

  it("omits a mixed source when whole-source and candidate redactions conflict", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [
                {
                  id: "mixed-fact",
                  content: "editor=Neovim",
                  explicitness: "explicit" as const,
                  kindHint: "fact" as const,
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                },
                {
                  id: "mixed-secret-noise",
                  content: "SECRET-PAYLOAD",
                  explicitness: "inferred" as const,
                  kindHint: "noise" as const,
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      policy: {
        redact(candidate) {
          return candidate.kindHint === "noise"
            ? { ...candidate, content: "[REDACTED]" }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "mixed-rejected-source-redaction", sessionId: "write" };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [{ role: "user", content: "editor=Neovim SECRET-PAYLOAD" }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });
    const serialized = JSON.stringify(exported.durable);

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(2);
    expect(exported.durable.sourceMessages).toEqual([]);
    expect(serialized).not.toContain("SECRET-PAYLOAD");
  });

  it("redacts the complete raw source even when extraction leaves text uncovered", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "partially-covered-fact",
                content: "editor=Neovim",
                explicitness: "explicit" as const,
                kindHint: "fact" as const,
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      policy: {
        redact(candidate) {
          return candidate.content.includes("SECRET-PAYLOAD")
            ? {
              ...candidate,
              content: candidate.content.replace("SECRET-PAYLOAD", "[REDACTED]"),
            }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "partially-covered-source-redaction",
      sessionId: "write",
    };

    await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [{ role: "user", content: "editor=Neovim SECRET-PAYLOAD" }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.sourceMessages).toEqual([
      expect.objectContaining({ content: "editor=Neovim [REDACTED]" }),
    ]);
    expect(JSON.stringify(exported.durable)).not.toContain("SECRET-PAYLOAD");
  });

  it("redacts an allowed raw source with a candidate rejected by another source role", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "cross-role-secret",
                content: "SECRET-PAYLOAD",
                explicitness: "inferred" as const,
                kindHint: "noise" as const,
                sourceMessageIndex: 0,
                sourceMessageIndexes: [0, 1],
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      policy: {
        redact(candidate) {
          return candidate.content === "SECRET-PAYLOAD"
            ? { ...candidate, content: "[REDACTED]" }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "cross-role-source-redaction", sessionId: "write" };

    await memory.remember({
      extractionStrategy: "llm-assisted",
      messages: [
        { role: "user", content: "editor=Neovim SECRET-PAYLOAD" },
        { role: "assistant", content: "SECRET-PAYLOAD" },
      ],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(JSON.stringify(exported.durable)).not.toContain("SECRET-PAYLOAD");
    expect(exported.durable.sourceMessages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: "editor=Neovim [REDACTED]",
      }),
    );
  });

  it("re-derives a durable target after policy changes the writable lane", async () => {
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          return candidate.kindHint === "fact"
            ? {
              ...candidate,
              content: "Tachikoma",
              kindHint: "profile",
              metadata: { profileField: "currentProject" },
            }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "post-redaction-target",
      sessionId: "write",
    };

    const result = await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        role: "user",
        content:
          "Remember two things: the build is stable; do not remember current project=Tachikoma",
      }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(result.events).toContainEqual(expect.objectContaining({
      outcome: "rejected",
      reason: "explicit_opt_out",
    }));
    expect(
      exported.durable.profile?.activeContext.currentProjects ?? [],
    ).toEqual([]);
    expect(exported.durable.facts).toEqual([]);
    expect(exported.durable.feedback).toHaveLength(1);
  });

  it("omits a raw source when a redacted producer rewrite has no trusted source span", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                id: "rewritten-profile",
                content: "name=Robert",
                explicitness: "explicit" as const,
                kindHint: "profile" as const,
                metadata: { profileField: "name" as const },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      policy: {
        redact(candidate) {
          return candidate.content.includes("Robert")
            ? { ...candidate, content: "[REDACTED]" }
            : candidate;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "rewritten-source-redaction", sessionId: "write" };

    const result = await memory.remember({
      extractionStrategy: "llm-assisted",
      locale: "en-US",
      messages: [{ role: "user", content: "People usually call me Robert" }],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.sourceMessages).toEqual([]);
    expect(JSON.stringify(exported.durable)).not.toContain("Robert");
  });
});
