import { describe, expect, it } from "bun:test";
import {
  createMemoryConfig,
  deriveRetrievalHealthFields,
  parseArgs,
} from "../../scripts/goodmemory-http-bridge";
import { createLifeCoachHttpRememberConfig } from "../../src/http";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("http bridge healthz retrieval visibility", () => {
  it("reports preset-recommended tier when the recommended preset is active", () => {
    expect(
      deriveRetrievalHealthFields({
        embeddingEnabled: true,
        retrievalPreset: { active: true, extraction: "conversational", requested: "recommended" },
      }),
    ).toEqual({ embeddingEnabled: "true", retrievalTier: "preset-recommended" });
  });

  it("reports rules-only + embeddingEnabled=true when embedding is wired but no preset (the informative gap)", () => {
    expect(
      deriveRetrievalHealthFields({ embeddingEnabled: true }),
    ).toEqual({ embeddingEnabled: "true", retrievalTier: "rules-only" });
  });

  it("reports rules-only + embeddingEnabled=false for a bare bridge", () => {
    expect(
      deriveRetrievalHealthFields({ embeddingEnabled: false }),
    ).toEqual({ embeddingEnabled: "false", retrievalTier: "rules-only" });
  });

  it("reports unknown tier when runtime info is unavailable", () => {
    expect(deriveRetrievalHealthFields(undefined)).toEqual({
      embeddingEnabled: "false",
      retrievalTier: "unknown",
    });
  });
});

describe("http bridge retrieval preset wiring", () => {
  it("defaults to no retrieval preset (byte-parity with today)", () => {
    const parsed = parseArgs([], EMPTY_ENV);
    expect(parsed.retrievalPreset).toBeUndefined();
    expect(createMemoryConfig({ profile: "default" })).toEqual({});
  });

  it("reads GOODMEMORY_HTTP_BRIDGE_RETRIEVAL_PRESET from env", () => {
    const parsed = parseArgs([], {
      GOODMEMORY_HTTP_BRIDGE_RETRIEVAL_PRESET: "recommended",
    } as NodeJS.ProcessEnv);
    expect(parsed.retrievalPreset).toBe("recommended");
  });

  it("reads --retrieval-preset flag (overrides env-less default)", () => {
    const parsed = parseArgs(["--retrieval-preset", "recommended"], EMPTY_ENV);
    expect(parsed.retrievalPreset).toBe("recommended");
  });

  it("rejects an unsupported retrieval preset", () => {
    expect(() =>
      parseArgs([], {
        GOODMEMORY_HTTP_BRIDGE_RETRIEVAL_PRESET: "aggressive",
      } as NodeJS.ProcessEnv),
    ).toThrow(/recommended/);
    expect(() => parseArgs(["--retrieval-preset", "nope"], EMPTY_ENV)).toThrow(
      /recommended/,
    );
  });

  it("threads the preset into the memory config", () => {
    expect(
      createMemoryConfig({ profile: "default", retrievalPreset: "recommended" }),
    ).toEqual({ retrieval: { preset: "recommended" } });
  });

  it("--recommended is a one-switch alias for the recommended retrieval preset", () => {
    expect(parseArgs(["--recommended"], EMPTY_ENV).retrievalPreset).toBe(
      "recommended",
    );
    // and the same via the env one-switch
    expect(
      parseArgs([], {
        GOODMEMORY_HTTP_BRIDGE_RECOMMENDED: "1",
      } as NodeJS.ProcessEnv).retrievalPreset,
    ).toBe("recommended");
  });

  it("treats GOODMEMORY_PROFILE=agent-recommended as the agent one-switch", () => {
    expect(
      parseArgs([], {
        GOODMEMORY_PROFILE: "agent-recommended",
      } as NodeJS.ProcessEnv).retrievalPreset,
    ).toBe("recommended");
  });

  it("keeps the life-coach remember profile alongside a retrieval preset", () => {
    const config = createMemoryConfig({
      profile: "life-coach",
      retrievalPreset: "recommended",
    });
    expect(config.retrieval).toEqual({ preset: "recommended" });
    expect(config.remember).toBeDefined();
  });

  it("keeps the life-coach profile free of locale-specific raw rules", () => {
    const profile = createLifeCoachHttpRememberConfig().profiles?.[0];

    expect(profile?.id).toBe("life-coach");
    expect(profile?.rules).toBeUndefined();
  });
});
