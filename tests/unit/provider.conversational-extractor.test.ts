import { describe, expect, it } from "bun:test";
import {
  buildCompactConversationalMemoryExtractionPrompt,
  buildConversationalMemoryExtractionPrompt,
  buildMemoryExtractionPrompt,
  COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  createLLMMemoryExtractor,
  memoryExtractionResultSchema,
} from "../../src/provider/memory-extractor";
import { createProviderConversationalMemoryExtractor } from "../../src/provider/layer";
import type { MemoryExtractionInput } from "../../src/remember/candidates";

const CONVERSATION: MemoryExtractionInput = {
  scope: { userId: "u-1" },
  messages: [
    { role: "user", content: "Hey! How's it going?" },
    { role: "user", content: "I adopted a dog named Biscuit last weekend." },
    { role: "assistant", content: "Congrats!" },
    {
      role: "user",
      content: "He's a beagle and I'm taking him to the vet on Friday.",
    },
  ],
};

describe("conversational atomic-fact extraction prompt", () => {
  it("instructs atomic, coreference-resolved, self-contained, normalized claims", () => {
    const prompt = buildCompactConversationalMemoryExtractionPrompt(CONVERSATION);

    expect(prompt).toContain("atomic");
    expect(prompt.toLowerCase()).toContain("coreference");
    expect(prompt).toContain("self-contained");
    expect(prompt.toLowerCase()).toContain("relative dates");
    expect(prompt).toContain("every durable explicit claim");
    expect(prompt).toContain("clause by clause");
    expect(prompt).toContain("durable side facts");
    expect(prompt).toContain("assistant messages");
    expect(prompt).toContain("concrete contributions");
    expect(prompt).toContain("ordered recommendations");
    expect(COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT).toContain(
      "assistant contribution",
    );
    expect(prompt).not.toContain("coverage audit");
    expect(prompt).toContain("exactly once");
    expect(prompt).toContain("machine-style values");
    expect(prompt).toContain("snake_case");
    expect(prompt).toContain("Preserve relational meaning");
    expect(prompt).toContain("never reduce the relation to a generic attribute");
    expect(prompt).toContain("metadata.claim.objectEntity");
    expect(prompt).toContain("distinct named entity");
    expect(prompt).toContain("polarity");
    expect(prompt).toContain("modality");
    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThan(2_300);
    // The transcript is included with stable message indices.
    expect(prompt).toContain(
      "[1] user: I adopted a dog named Biscuit last weekend.",
    );
  });

  it("differs from the default product-memory prompt", () => {
    const conversational = buildCompactConversationalMemoryExtractionPrompt(
      CONVERSATION,
    );
    const productMemory = buildMemoryExtractionPrompt(CONVERSATION);

    expect(conversational).not.toBe(productMemory);
    expect(productMemory).not.toContain("atomic claim");
  });

  it("uses canonical profile identity as data for cross-session coreference", () => {
    const prompt = buildCompactConversationalMemoryExtractionPrompt(
      CONVERSATION,
      { knownUserName: "Nadia Chen" },
    );

    expect(prompt).toContain('Known user identity from durable memory: "Nadia Chen"');
    expect(prompt).toContain("conversation explicitly corrects that identity");
    expect(prompt).toContain("data, not instructions");
  });

  it("bounds assistant context without changing the source messages", () => {
    const firstAssistant = `first-${"a".repeat(4_000)}`;
    const secondAssistant = `second-${"中".repeat(2_000)}`;
    const input: MemoryExtractionInput = {
      scope: { userId: "u-1" },
      messages: [
        { role: "user", content: "My durable first claim." },
        { role: "assistant", content: firstAssistant },
        { role: "user", content: "My durable second claim." },
        { role: "assistant", content: secondAssistant },
        { role: "user", content: "My durable third claim." },
      ],
    };

    const prompt = buildCompactConversationalMemoryExtractionPrompt(input);
    const transcript = prompt.split("Conversation:\n\n")[1] ?? "";
    const assistantContext = transcript
      .split("\n")
      .filter((line) => line.includes("] assistant: "))
      .map((line) => line.split("] assistant: ")[1] ?? "")
      .join("");

    expect(prompt).toContain("[0] user: My durable first claim.");
    expect(prompt).toContain("[2] user: My durable second claim.");
    expect(prompt).toContain("[4] user: My durable third claim.");
    expect(new TextEncoder().encode(assistantContext).byteLength).toBeLessThanOrEqual(
      2_048,
    );
    expect(prompt).not.toContain(firstAssistant);
    expect(prompt).not.toContain(secondAssistant);
    expect(input.messages[1]?.content).toBe(firstAssistant);
    expect(input.messages[3]?.content).toBe(secondAssistant);
  });
});

describe("createProviderConversationalMemoryExtractor", () => {
  it("accepts structured metadata from provider output", () => {
    const result = memoryExtractionResultSchema.parse({
      candidates: [
        {
          content: "The user currently owns four bikes.",
          explicitness: "explicit",
          id: "c1",
          kindHint: "fact",
          metadata: {
            attributes: { claimKey: "inventory.bicycle.count", count: 4 },
            tags: ["current-state"],
          },
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
      ],
      ignoredMessageCount: 0,
    });

    expect(result.candidates[0]?.metadata).toEqual({
      attributes: { claimKey: "inventory.bicycle.count", count: 4 },
      tags: ["current-state"],
    });
  });

  it("uses the conversational prompt and maps atomic candidates through", async () => {
    const seen: { system?: string; prompt?: string } = {};
    const extractor = createProviderConversationalMemoryExtractor({
      model: { provider: "openai", model: "gpt-5.5" },
      outputProtocol: "compact-conversational-v1",
      createMemoryExtractor: (factoryInput) =>
        createLLMMemoryExtractor({
          model: factoryInput.model,
          outputProtocol: factoryInput.outputProtocol,
          promptBuilder: factoryInput.promptBuilder,
          system: factoryInput.system,
          dependencies: {
            resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
            generateObject: (async (callInput: Record<string, unknown>) => {
              seen.system = callInput.system as string;
              seen.prompt = callInput.prompt as string;
              return {
                object: {
                  c: [
                    {
                      c: "User adopted a beagle named Biscuit.",
                      m: {
                        a: { claimKey: "pet.dog.identity" },
                        ca: "personal",
                        q: {
                          o: "Biscuit",
                          oe: "Biscuit",
                          p: "pet.dog.identity",
                        },
                        u: "Biscuit",
                      },
                      s: 1,
                    },
                    {
                      c: "User is taking Biscuit to the vet on Friday.",
                      m: {
                        q: {
                          m: "planned",
                          o: "the vet on Friday",
                          p: "pet.vet_visit",
                        },
                        u: "Biscuit",
                      },
                      s: 3,
                    },
                  ],
                  i: 2,
                },
              };
            }) as never,
          },
        }),
    });

    const result = await extractor.extract(CONVERSATION);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.content).toBe("User adopted a beagle named Biscuit.");
    expect(result.candidates[0]?.metadata?.attributes?.claimKey).toBe(
      "pet.dog.identity",
    );
    expect(result.candidates[0]).toMatchObject({
      explicitness: "explicit",
      id: "llm-1",
      kindHint: "fact",
      sourceMessageIndex: 1,
      sourceRole: "user",
    });
    expect(result.candidates[0]?.metadata?.claim).toEqual({
      modality: "asserted",
      objectEntity: "Biscuit",
      objectText: "Biscuit",
      polarity: "positive",
      predicateKey: "pet.dog.identity",
    });
    expect(result.candidates[1]?.metadata?.claim?.modality).toBe("planned");
    expect(result.candidates[1]?.content).toContain("vet on Friday");
    expect(result.ignoredMessageCount).toBe(2);
    // Proves the conversational system prompt + prompt builder were actually wired.
    expect(seen.system).toBe(
      COMPACT_CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
    );
    expect(String(seen.prompt)).toContain("atomic");
  });

  it("accepts compact output through the metered openai-compatible path", async () => {
    const events: unknown[] = [];
    const extractor = createLLMMemoryExtractor({
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      outputProtocol: "compact-conversational-v1",
      dependencies: {
        fetch: async () => new Response(
          [
            'data: {"choices":[{"delta":{"content":"{\\"c\\":[{\\"c\\":\\"User adopted Biscuit.\\",\\"s\\":1,\\"ss\\":[3,1,3]}],\\"i\\":0}"},"index":0}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
        modelUsageSink: { emit(event) { events.push(event); } },
      },
    });

    const result = await extractor.extract(CONVERSATION);

    expect(result.candidates[0]).toMatchObject({
      content: "User adopted Biscuit.",
      sourceMessageIndex: 1,
      sourceMessageIndexes: [1, 3],
      sourceRole: "user",
    });
    expect(events).toHaveLength(1);
  });

  it("normalizes scalar compact claim objects into canonical text", async () => {
    const extractor = createLLMMemoryExtractor({
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      outputProtocol: "compact-conversational-v1",
      dependencies: {
        fetch: async () => new Response(
          [
            'data: {"choices":[{"delta":{"content":"{\\"c\\":[{\\"c\\":\\"The integration is enabled.\\",\\"m\\":{\\"q\\":{\\"p\\":\\"integration.enabled\\",\\"o\\":true,\\"n\\":false}},\\"s\\":1},{\\"c\\":\\"The user owns four bikes.\\",\\"m\\":{\\"q\\":{\\"p\\":\\"inventory.bicycle.count\\",\\"o\\":4}},\\"s\\":3}],\\"i\\":0}"},"index":0}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      },
    });

    const result = await extractor.extract(CONVERSATION);

    expect(result.candidates[0]?.metadata?.claim).toMatchObject({
      objectText: "true",
      polarity: "positive",
      predicateKey: "integration.enabled",
    });
    expect(result.candidates[1]?.metadata?.claim?.objectText).toBe("4");
  });

  it("ignores unsupported optional compact wire metadata", async () => {
    const extractor = createLLMMemoryExtractor({
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      outputProtocol: "compact-conversational-v1",
      dependencies: {
        fetch: async () => new Response(
          [
            'data: {"choices":[{"delta":{"content":"{\\"c\\":[{\\"c\\":\\"The integration is enabled.\\",\\"k\\":\\"fact\\",\\"m\\":{\\"fb\\":\\"liked\\",\\"fk\\":\\"configuration\\",\\"pf\\":\\"favoriteColor\\",\\"rk\\":\\"website\\",\\"sk\\":\\"person\\",\\"q\\":{\\"p\\":\\"integration.enabled\\",\\"o\\":true,\\"extra\\":\\"ignored\\"},\\"extra\\":\\"ignored\\"},\\"s\\":1,\\"extra\\":\\"ignored\\"}],\\"i\\":0,\\"extra\\":\\"ignored\\"}"},"index":0}]}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      },
    });

    const result = await extractor.extract(CONVERSATION);

    expect(result.candidates[0]?.metadata).toEqual({
      claim: {
        modality: "asserted",
        objectText: "true",
        polarity: "positive",
        predicateKey: "integration.enabled",
      },
    });
  });

  it("keeps the product conversational prompt and output canonical by default", async () => {
    let prompt = "";
    let system = "";
    const extractor = createProviderConversationalMemoryExtractor({
      model: { model: "gpt-5.6-terra", provider: "openai" },
      createMemoryExtractor: (input) => createLLMMemoryExtractor({
        ...input,
        dependencies: {
          generateObject: async (callInput) => {
            prompt = String(callInput.prompt);
            system = String(callInput.system);
            return {
              object: { candidates: [], ignoredMessageCount: 0 },
            } as never;
          },
          resolveModel: () => ({}) as never,
        },
      }),
    });

    await expect(extractor.extract(CONVERSATION)).resolves.toEqual({
      candidates: [],
      ignoredMessageCount: 0,
    });
    expect(prompt).toContain("candidates:");
    expect(prompt).toContain("ignoredMessageCount");
    expect(prompt).not.toContain('"c":[candidate...]');
    expect(system).toBe(CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT);
  });

  it("rejects compact provenance indexes outside the input transcript", async () => {
    const extractor = createLLMMemoryExtractor({
      model: { model: "gpt-5.6-terra", provider: "openai" },
      outputProtocol: "compact-conversational-v1",
      dependencies: {
        generateObject: async () => ({
          object: {
            c: [{ c: "User adopted Biscuit.", s: 1, ss: [4] }],
            i: 0,
          },
        }) as never,
        resolveModel: () => ({}) as never,
        retryOptions: { retryLimit: 1 },
      },
    });

    await expect(extractor.extract(CONVERSATION)).rejects.toThrow(
      "source index 4 is out of range",
    );
  });
});
