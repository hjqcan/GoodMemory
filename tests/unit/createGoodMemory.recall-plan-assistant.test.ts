import { describe, expect, it, spyOn } from "bun:test";

import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src";
import { buildDeterministicRecallPlan } from "../../src/recall/recallPlan";

const scope = { userId: "user-1", workspaceId: "workspace-1" };
const now = new Date("2026-07-18T12:00:00.000Z");

describe("GoodMemory.recall query-only planner adapter", () => {
  it("keeps RecallPlan and claim-channel execution off for a bare config", async () => {
    let plannerCalls = 0;
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan() {
            plannerCalls += 1;
            return { entities: ["atlas"], maxHops: 3 };
          },
        },
      },
      storage: { provider: "memory" },
      testing: { now: () => now },
    });

    const result = await memory.recall({
      query: "What changed about Atlas over time?",
      scope,
      strategy: "rules-only",
    });

    expect(plannerCalls).toBe(0);
    expect(result.metadata.retrievalTrace).toMatchObject({
      plan: {
        entities: [],
        evidenceNeeds: ["direct"],
        facets: [],
        maxHops: 1,
        planes: ["semantic"],
      },
      stopReason: "single_pass_complete",
      subQueries: [],
    });
  });

  it("does not resolve or apply a query plan when execution is disabled", async () => {
    let plannerCalls = 0;
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan() {
            plannerCalls += 1;
            return {
              aggregation: "count",
              entities: ["atlas"],
              facets: ["Atlas current status"],
              maxHops: 3,
              temporalConstraints: [{
                kind: "current",
                referenceTime: now.toISOString(),
              }],
            };
          },
        },
      },
      retrieval: { recallPlanExecution: false },
      storage: { provider: "memory" },
      testing: { now: () => now },
    });

    const result = await memory.recall({
      query: "How many current Atlas projects are active and what changed?",
      scope,
      strategy: "rules-only",
    });

    expect(plannerCalls).toBe(0);
    expect(result.metadata.policyApplied).not.toContain(
      "recall_plan_assistant_applied",
    );
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      plan: {
        entities: [],
        evidenceNeeds: ["direct"],
        facets: [],
        maxHops: 1,
        planes: ["semantic"],
        temporalConstraints: [],
        uncertainty: "low",
      },
      stopReason: "single_pass_complete",
      subQueries: [],
    });
  });

  it("uses the assisted plan in the public retrieval trace while preserving fixed budgets", async () => {
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan(input) {
            expect(input).toEqual({
              deterministicPlan: buildDeterministicRecallPlan({
                locale: "zh-CN",
                query: "Atlas 和 Beacon 当前分别是什么状态？",
                referenceTime: now.toISOString(),
                scope,
              }),
              locale: "zh-CN",
              query: "Atlas 和 Beacon 当前分别是什么状态？",
              referenceTime: now.toISOString(),
              scope,
            });
            return {
              entities: ["atlas", "beacon"],
              facets: ["Atlas 当前状态", "Beacon 当前状态"],
              maxHops: 2,
              preRankLimit: 1_000,
              selectedLimit: 1_000,
              maxRenderedTokens: 1_000_000,
            };
          },
        },
      },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
      testing: { now: () => now },
    });

    const result = await memory.recall({
      locale: "zh-CN",
      query: "Atlas 和 Beacon 当前分别是什么状态？",
      scope,
      strategy: "rules-only",
    });

    expect(result.metadata.policyApplied).toContain(
      "recall_plan_assistant_applied",
    );
    expect(result.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      plan: {
        entities: ["atlas", "beacon"],
        facets: ["Atlas 当前状态", "Beacon 当前状态"],
        maxHops: 1,
        preRankLimit: 32,
        selectedLimit: 12,
        maxRenderedTokens: 6_000,
      },
    });
  });

  it("falls back to the same deterministic plan and records a query-free diagnostic", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const memory = createGoodMemory({
      adapters: {
        documentStore: createInMemoryDocumentStore(),
        sessionStore: createInMemorySessionStore(),
        recallPlanner: {
          async plan() {
            throw new Error("provider unavailable");
          },
        },
      },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
      testing: { now: () => now },
    });

    try {
      const query = "What changed about private-project-codename over time?";
      const result = await memory.recall({
        locale: "en",
        query,
        scope,
        strategy: "rules-only",
      });

      expect(result.metadata.policyApplied).toContain(
        "recall_plan_assistant_fallback",
      );
      expect(result.metadata.retrievalTrace).toMatchObject({
        schemaVersion: 2,
        plan: buildDeterministicRecallPlan({
          locale: "en",
          query,
          referenceTime: now.toISOString(),
          scope,
        }),
      });
      expect(consoleError).toHaveBeenCalledWith(
        "[goodmemory:recall-plan] assisted planning failed; using deterministic plan",
        { locale: "en", queryLength: query.length },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "private-project-codename",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
