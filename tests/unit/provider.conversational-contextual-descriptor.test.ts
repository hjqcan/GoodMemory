import { describe, expect, it } from "bun:test";
import {
  buildCompactConversationalMemoryExtractionPrompt,
  createLLMMemoryExtractor,
} from "../../src/provider/memory-extractor";
import { createProviderConversationalMemoryExtractor } from "../../src/provider/layer";
import type { MemoryExtractionInput } from "../../src/remember/candidates";

const CONVERSATION: MemoryExtractionInput = {
  scope: { userId: "u-1" },
  messages: [
    { role: "user", content: "I adopted a dog named Biscuit last weekend." },
    { role: "user", content: "He's a beagle and I'm taking him to the vet on Friday." },
  ],
};

describe("conversational contextual-descriptor option", () => {
  it("adds the descriptor instruction only when enabled", () => {
    const withDescriptor = buildCompactConversationalMemoryExtractionPrompt(
      CONVERSATION,
      { contextualDescriptor: true },
    );
    const withoutDescriptor = buildCompactConversationalMemoryExtractionPrompt(
      CONVERSATION,
    );
    expect(withDescriptor.toLowerCase()).toContain("contextual descriptor");
    expect(withoutDescriptor.toLowerCase()).not.toContain(
      "contextual descriptor",
    );
    // Default (no options) is unchanged: still the same atomic-fact prompt.
    expect(withoutDescriptor).toBe(
      buildCompactConversationalMemoryExtractionPrompt(CONVERSATION),
    );
  });

  it("threads the option through the provider factory into the built prompt", async () => {
    const seen: { prompt?: string; protocol?: string } = {};
    const extractor = createProviderConversationalMemoryExtractor({
      model: { provider: "openai", model: "gpt-5.5" },
      contextualDescriptor: true,
      outputProtocol: "compact-conversational-v1",
      createMemoryExtractor: (factoryInput) => {
        seen.protocol = factoryInput.outputProtocol;
        return createLLMMemoryExtractor({
          model: factoryInput.model,
          outputProtocol: factoryInput.outputProtocol,
          promptBuilder: factoryInput.promptBuilder,
          system: factoryInput.system,
          dependencies: {
            resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
            generateObject: (async (callInput: Record<string, unknown>) => {
              seen.prompt = callInput.prompt as string;
              return { object: { c: [], i: 0 } };
            }) as never,
          },
        });
      },
    });

    await extractor.extract(CONVERSATION);
    expect(String(seen.prompt).toLowerCase()).toContain("contextual descriptor");
    expect(seen.protocol).toBe("compact-conversational-v1");
  });
});
