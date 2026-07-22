import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  rememberRules,
} from "../../src";

describe("public remember profile customization", () => {
  it("applies a scope-matched domain rule without replacing the core pipeline", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        preset: "default",
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extends: "default",
            rules: [
              rememberRules.fact(/my top priority this quarter is (.+)/i, {
                id: "life-goal-priority",
                category: "goal",
                tags: ["life_coach", "long_term_goal"],
                content: ({ match }) => match[1] ?? "",
              }),
            ],
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "user",
          content: "My top priority this quarter is rebuilding my sleep routine.",
        },
      ],
      extractionStrategy: "rules-only",
    });

    expect(result.accepted).toBeGreaterThanOrEqual(1);
    expect(result.events.some((event) => event.reason === "explicit_fact")).toBe(true);
    expect(result.events.some((event) => event.profileId === "life-coach")).toBe(true);
    expect(result.events.some((event) => event.ruleIds?.includes("life-goal-priority"))).toBe(true);

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", agentId: "life-coach" },
    });

    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.category).toBe("goal");
    expect(exported.durable.facts[0]?.tags).toEqual([
      "life_coach",
      "long_term_goal",
    ]);
    expect(exported.durable.facts[0]?.content).toBe(
      "rebuilding my sleep routine.",
    );
  });

  it("stamps resolved profile and preset on default preset extraction traces", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "user",
          content: "Remember that the current blocker is vendor approval for sleep program launch.",
        },
      ],
      extractionStrategy: "rules-only",
    });
    const writtenEvent = result.events.find((event) => event.outcome === "written");

    expect(result.accepted).toBeGreaterThanOrEqual(1);
    expect(writtenEvent).toMatchObject({
      profileId: "life-coach",
      presetId: "default",
    });
  });

  it("stamps resolved profile and preset on assisted-only extraction traces", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [
                {
                  id: "assisted-values-context",
                  kindHint: "fact",
                  explicitness: "explicit",
                  profileId: "wrong-profile",
                  presetId: "wrong-preset",
                  content: "Family dinners are a core weekly anchor.",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: {
                    category: "value",
                    tags: ["life_coach", "values"],
                  },
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "user",
          content: "Family dinners are a core weekly anchor.",
        },
      ],
      extractionStrategy: "llm-assisted",
    });
    const writtenEvent = result.events.find((event) => event.outcome === "written");

    expect(result.accepted).toBe(1);
    expect(writtenEvent).toMatchObject({
      extractionSources: ["llm-assisted"],
      profileId: "life-coach",
      presetId: "default",
    });
  });

  it("keeps assistant-originated durable writes disabled unless a profile opts in", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "assistant",
          content: "A weekly review cadence may help.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "always",
          kindHint: "fact",
          confirmed: true,
          metadataPatch: {
            category: "habit",
            tags: ["weekly_review"],
          },
        },
      ],
    });

    expect(result.accepted).toBe(0);
    expect(result.events.some((event) => event.reason === "assistant_policy_blocked")).toBe(true);
  });

  it("allows confirmed assistant-originated writes under an explicit profile policy", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            assistantOutputs: { mode: "confirmed_or_verified_only" },
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "assistant",
          content: "A weekly review cadence may help.",
        },
        {
          role: "user",
          content: "Yes, let's use that.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "always",
          kindHint: "fact",
          confirmed: true,
          metadataPatch: {
            category: "habit",
            tags: ["life_coach", "weekly_review"],
            attributes: { cadence: "weekly" },
          },
        },
      ],
    });

    expect(result.accepted).toBeGreaterThanOrEqual(1);
    expect(result.events.some((event) => event.profileId === "life-coach")).toBe(true);

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", agentId: "life-coach" },
    });

    expect(exported.durable.facts[0]?.content).toBe(
      "A weekly review cadence may help.",
    );
    expect(exported.durable.facts[0]?.category).toBe("habit");
    expect(exported.durable.facts[0]?.attributes).toEqual({
      cadence: "weekly",
    });
  });

  it("allows verified extracted assistant facts without forcing unextracted messages", async () => {
    const memory = createGoodMemory({
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [{
                content: "The deployment finished after the migration completed.",
                explicitness: "explicit",
                id: "assistant-fact",
                kindHint: "fact",
                sourceMessageIndex: 0,
                sourceRole: "assistant",
              }],
              ignoredMessageCount: 1,
            };
          },
        },
      },
      remember: {
        profiles: [{
          assistantOutputs: { mode: "confirmed_or_verified_only" },
          id: "external-evidence",
        }],
      },
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return { candidates: [], ignoredMessageCount: 2 };
          },
        },
      },
    });
    const scope = { userId: "u-external-evidence" };

    const result = await memory.remember({
      annotations: [0, 1].map((messageIndex) => ({
        confirmed: true,
        messageIndex,
        remember: "auto" as const,
        verified: true,
      })),
      extractionStrategy: "llm-assisted",
      messages: [
        {
          content: "The deployment finished after the migration completed.",
          role: "assistant",
        },
        {
          content: "Happy to help.",
          role: "assistant",
        },
      ],
      scope,
    });
    const exported = await memory.exportMemory({ scope });

    expect(result.accepted).toBe(1);
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.content).toBe(
      "The deployment finished after the migration completed.",
    );
    expect(exported.durable.facts[0]?.content).not.toBe("Happy to help.");
  });

  it("keeps unverified and never-annotated assistant candidates blocked", async () => {
    const memory = createGoodMemory({
      remember: {
        profiles: [{
          assistantOutputs: { mode: "confirmed_or_verified_only" },
          id: "external-evidence",
        }],
      },
      storage: { provider: "memory" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: [{
                content: "The deployment finished.",
                explicitness: "explicit",
                id: "assistant-fact",
                kindHint: "fact",
                sourceMessageIndex: 0,
                sourceRole: "assistant",
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });

    const unverified = await memory.remember({
      annotations: [{ messageIndex: 0, remember: "auto" }],
      messages: [{ content: "The deployment finished.", role: "assistant" }],
      scope: { userId: "u-unverified" },
    });
    const never = await memory.remember({
      annotations: [{
        confirmed: true,
        messageIndex: 0,
        remember: "never",
        verified: true,
      }],
      messages: [{ content: "The deployment finished.", role: "assistant" }],
      scope: { userId: "u-never" },
    });

    expect(unverified.accepted).toBe(0);
    expect(unverified.events[0]?.reason).toBe("assistant_policy_blocked");
    expect(never.accepted).toBe(0);
  });

  it("persists preference metadata produced by public rules", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            rules: [
              rememberRules.preference(/please coach me with (.+)/i, {
                id: "life-coaching-style",
                category: "coaching_style",
                value: ({ match }) => match[1] ?? "",
                tags: ["life_coach", "coaching_style"],
                attributes: { source: "domain_rule" },
              }),
            ],
          },
        ],
      },
    });

    await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "user",
          content: "Please coach me with concise weekly planning prompts.",
        },
      ],
      extractionStrategy: "rules-only",
    });

    const exported = await memory.exportMemory({
      scope: { userId: "u-1", agentId: "life-coach" },
    });

    expect(exported.durable.preferences[0]).toMatchObject({
      category: "coaching_style",
      value: "concise weekly planning prompts.",
      tags: ["life_coach", "coaching_style"],
      attributes: { source: "domain_rule" },
    });
  });

  it("enriches duplicate facts and references with profile metadata", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extractors: [
              {
                async extract(input) {
                  const tagged = input.messages[0]?.content.includes("tagged");

                  return {
                    candidates: [
                      {
                        id: tagged ? "fact-tagged" : "fact-base",
                        kindHint: "fact",
                        explicitness: "explicit",
                        content: "Launch planning is blocked on legal review.",
                        sourceMessageIndex: 0,
                        sourceRole: "user",
                        metadata: tagged
                          ? {
                              attributes: { source: "profile_extractor" },
                              category: "goal",
                              tags: ["life_coach", "planning"],
                            }
                          : {
                              category: "project",
                            },
                      },
                      {
                        id: tagged ? "reference-tagged" : "reference-base",
                        kindHint: "reference",
                        explicitness: "explicit",
                        content: "docs/launch-plan.md",
                        sourceMessageIndex: 0,
                        sourceRole: "user",
                        metadata: tagged
                          ? {
                              attributes: { source: "profile_extractor" },
                              referenceKind: "runbook",
                              referencePointer: "docs/launch-plan.md",
                              tags: ["life_coach", "planning"],
                            }
                          : {
                              referencePointer: "docs/launch-plan.md",
                            },
                      },
                    ],
                    ignoredMessageCount: 0,
                  };
                },
              },
            ],
          },
        ],
      },
    });
    const scope = { userId: "u-1", agentId: "life-coach" };

    await memory.remember({
      scope,
      messages: [{ role: "user", content: "base" }],
      extractionStrategy: "rules-only",
    });
    await memory.remember({
      scope,
      messages: [{ role: "user", content: "tagged" }],
      extractionStrategy: "rules-only",
    });

    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]).toMatchObject({
      attributes: { source: "profile_extractor" },
      category: "goal",
      tags: ["life_coach", "planning"],
    });
    expect(exported.durable.references).toHaveLength(1);
    expect(exported.durable.references[0]).toMatchObject({
      attributes: { source: "profile_extractor" },
      referenceKind: "runbook",
      tags: ["life_coach", "planning"],
    });
  });

  it("keeps never-annotated messages out of deterministic and assisted extraction", async () => {
    const assistedInputs: string[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        assistedExtractor: {
          async extract(input) {
            assistedInputs.push(input.messages[0]?.content ?? "");

            return {
              candidates: [
                {
                  id: "assisted-private-goal",
                  kindHint: "fact",
                  explicitness: "explicit",
                  content: "Private coaching goal should not persist.",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: { category: "goal" },
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            rules: [
              rememberRules.fact(/private goal: (.+)/i, {
                id: "private-goal",
                category: "goal",
                content: ({ match }) => match[1] ?? "",
              }),
            ],
          },
        ],
      },
    });
    const scope = { userId: "u-1", agentId: "life-coach" };

    const result = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Private goal: do not retain this sensitive detail.",
        },
      ],
      annotations: [
        {
          messageIndex: 0,
          remember: "never",
          reason: "host privacy suppression",
        },
      ],
      extractionStrategy: "llm-assisted",
    });
    const exported = await memory.exportMemory({ scope });

    expect(assistedInputs).toEqual([""]);
    expect(result.accepted).toBe(0);
    expect(exported.durable.facts).toHaveLength(0);
  });

  it("composes profile custom extractors with assisted extraction without losing trace", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [
                {
                  id: "assisted-launch-owner",
                  kindHint: "fact",
                  explicitness: "explicit",
                  content: "Maya owns the launch checklist.",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: {
                    category: "project",
                    factKind: "project_state",
                    subject: "launch checklist",
                  },
                },
              ],
              ignoredMessageCount: 0,
            };
          },
        },
      },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extractors: [
              {
                async extract() {
                  return {
                    candidates: [
                      {
                        id: "profile-launch-owner",
                        kindHint: "fact",
                        explicitness: "explicit",
                        content: "Maya owns the launch checklist.",
                        sourceMessageIndex: 0,
                        sourceRole: "user",
                        metadata: {
                          category: "project",
                          factKind: "project_state",
                          subject: "launch checklist",
                        },
                      },
                    ],
                    ignoredMessageCount: 0,
                  };
                },
              },
            ],
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [{ role: "user", content: "Maya owns the launch checklist." }],
      extractionStrategy: "llm-assisted",
    });

    const writtenEvent = result.events.find((event) => event.outcome === "written");

    expect(result.accepted).toBe(1);
    expect(writtenEvent).toMatchObject({
      extractionSources: ["rules-only", "llm-assisted"],
      extractorIds: ["life-coach:extractor-1"],
      profileId: "life-coach",
      presetId: "default",
    });
  });

  it("uses stable public ids for named profile extractors in remember traces", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extractors: [
              {
                id: "life-coach-values-extractor",
                extractor: {
                  async extract() {
                    return {
                      candidates: [
                        {
                          id: "life-core-value",
                          kindHint: "fact",
                          explicitness: "explicit",
                          content: "Family dinners are a core weekly anchor.",
                          sourceMessageIndex: 0,
                          sourceRole: "user",
                          metadata: {
                            category: "value",
                            tags: ["life_coach", "values"],
                          },
                        },
                      ],
                      ignoredMessageCount: 0,
                    };
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [
        {
          role: "user",
          content: "Family dinners are a core weekly anchor.",
        },
      ],
      extractionStrategy: "rules-only",
    });
    const writtenEvent = result.events.find((event) => event.outcome === "written");

    expect(result.accepted).toBe(1);
    expect(writtenEvent).toMatchObject({
      extractorIds: ["life-coach-values-extractor"],
      profileId: "life-coach",
      presetId: "default",
    });
  });

  it("dedupes candidates after annotation metadata enrichment", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        assistedExtractor: {
          async extract() {
            return {
              candidates: [
                {
                  id: "assisted-launch-goal",
                  kindHint: "fact",
                  explicitness: "explicit",
                  content: "Maya owns the launch checklist.",
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
      },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extractors: [
              {
                async extract() {
                  return {
                    candidates: [
                      {
                        id: "profile-launch-goal",
                        kindHint: "fact",
                        explicitness: "explicit",
                        content: "Maya owns the launch checklist.",
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
            ],
          },
        ],
      },
    });

    const result = await memory.remember({
      scope: { userId: "u-1", agentId: "life-coach" },
      messages: [{ role: "user", content: "Maya owns the launch checklist." }],
      annotations: [
        {
          messageIndex: 0,
          metadataPatch: {
            tags: ["life_coach", "launch"],
          },
        },
      ],
      extractionStrategy: "llm-assisted",
    });
    const writtenEvents = result.events.filter(
      (event) => event.outcome === "written",
    );

    expect(result.accepted).toBe(1);
    expect(writtenEvents).toHaveLength(1);
    expect(writtenEvents[0]).toMatchObject({
      annotation: {
        metadataPatched: true,
        remember: "auto",
      },
      extractionSources: ["rules-only", "llm-assisted"],
      extractorIds: ["life-coach:extractor-1"],
    });
  });

  it("enriches duplicate feedback with profile metadata", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      remember: {
        profiles: [
          {
            id: "life-coach",
            when: { agentId: "life-coach" },
            extractors: [
              {
                async extract(input) {
                  const tagged = input.messages[0]?.content.includes("tagged");

                  return {
                    candidates: [
                      {
                        id: tagged ? "feedback-tagged" : "feedback-base",
                        kindHint: "feedback",
                        explicitness: "explicit",
                        content: "Keep coaching prompts concise.",
                        sourceMessageIndex: 0,
                        sourceRole: "user",
                        metadata: tagged
                          ? {
                              attributes: { source: "profile_extractor" },
                              feedbackKind: "do",
                              tags: ["life_coach", "tone"],
                            }
                          : {
                              feedbackKind: "do",
                            },
                      },
                    ],
                    ignoredMessageCount: 0,
                  };
                },
              },
            ],
          },
        ],
      },
    });
    const scope = { userId: "u-1", agentId: "life-coach" };

    await memory.remember({
      scope,
      messages: [{ role: "user", content: "base" }],
      extractionStrategy: "rules-only",
    });
    await memory.remember({
      scope,
      messages: [{ role: "user", content: "tagged" }],
      extractionStrategy: "rules-only",
    });

    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.feedback).toHaveLength(1);
    expect(exported.durable.feedback[0]).toMatchObject({
      attributes: { source: "profile_extractor" },
      tags: ["life_coach", "tone"],
    });
  });
});
