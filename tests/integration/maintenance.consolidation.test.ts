import { describe, expect, it } from "bun:test";
import { createEpisodeMemory } from "../../src/domain/records";
import { createSessionArchive } from "../../src/evolution/contracts";
import {
  createMaintenanceRunner,
} from "../../src/maintenance/runner";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";

describe("maintenance consolidation", () => {
  it("consolidates related active episodes and archives originals", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Recall refactor covered routing and semantic selection.",
        topics: ["recall", "routing", "semantic"],
        unresolvedItems: ["budget-aware context output"],
        keyDecisions: ["keep router deterministic"],
        importance: 0.8,
        confidence: 0.9,
        observedAt: "2025-12-01T00:00:00.000Z",
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        summary: "Recall work continued with episodic retrieval and context sections.",
        topics: ["recall", "episodes", "semantic"],
        unresolvedItems: ["finalize markdown output"],
        keyDecisions: ["add episode summaries"],
        importance: 0.85,
        confidence: 0.92,
        observedAt: "2025-12-02T00:00:00.000Z",
        createdAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["consolidation"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const episodes = await repositories.episodes.listByScope(scope);
    const archives = await repositories.archives.listByScope(scope);
    const archived = episodes.filter((episode) => episode.archivedAt);
    const active = episodes.filter((episode) => !episode.archivedAt);

    expect(archived).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0]?.summary).toContain("Consolidated");
    expect(active[0]?.topics).toContain("recall");
    expect(active[0]?.observedAt).toBe("2025-12-01T00:00:00.000Z");
    expect(archives).toHaveLength(2);
    expect(archives.map((archive) => archive.sessionId).sort()).toEqual(["s-1", "s-2"]);
    expect(archives[0]?.summary).toContain("Recall");
  });

  it("consolidates related Chinese episodes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const scope = { userId: "u-zh", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-zh-1",
        userId: "u-zh",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "上次会话聚焦迁移流程和审批阻塞。",
        topics: ["迁移流程", "审批阻塞"],
        unresolvedItems: ["等待审批"],
        keyDecisions: ["继续跟进审批"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-zh-2",
        userId: "u-zh",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        summary: "本次会话继续处理迁移流程，确认审批仍未完成。",
        topics: ["迁移流程", "审批"],
        unresolvedItems: ["确认审批时间"],
        keyDecisions: ["维持当前方案"],
        importance: 0.82,
        confidence: 0.91,
        createdAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["consolidation"]);
    expect(report.jobs[0]?.applied).toBe(1);
  });

  it("does not duplicate an existing archive when maintenance salvages archived episodes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Recall refactor covered routing and semantic selection.",
        topics: ["recall", "routing", "semantic"],
        unresolvedItems: ["budget-aware context output"],
        keyDecisions: ["keep router deterministic"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        summary: "Recall work continued with episodic retrieval and context sections.",
        topics: ["recall", "episodes", "semantic"],
        unresolvedItems: ["finalize markdown output"],
        keyDecisions: ["add episode summaries"],
        importance: 0.85,
        confidence: 0.92,
        createdAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.archives.add(
      createSessionArchive({
        id: "archive-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Existing session archive for s-1.",
        createdAt: "2026-03-30T00:00:00.000Z",
        archivedAt: "2026-03-30T00:00:00.000Z",
      }),
    );

    await runner.run(scope, ["consolidation"]);

    const archives = await repositories.archives.listByScope(scope);

    expect(archives).toHaveLength(2);
    expect(archives.filter((archive) => archive.sessionId === "s-1")).toHaveLength(1);
    expect(archives.some((archive) => archive.sessionId === "s-2")).toBe(true);
  });

  it("merges salvaged archive content when both archived episodes come from the same session", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-same-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "same-session",
        summary: "Earlier session pass mapped the recall pipeline.",
        topics: ["maintenance", "archive", "pipeline"],
        unresolvedItems: ["finalize archive merge"],
        keyDecisions: ["keep pipeline staging explicit"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-same-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "same-session",
        summary: "Later session pass confirmed maintenance salvage behavior.",
        topics: ["maintenance", "archive", "salvage"],
        unresolvedItems: ["ship regression coverage"],
        keyDecisions: ["merge archive entries by concrete scope"],
        importance: 0.82,
        confidence: 0.91,
        createdAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["consolidation"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const archives = await repositories.archives.listByScope(scope);

    expect(archives).toHaveLength(1);
    expect(archives[0]?.sessionId).toBe("same-session");
    expect(archives[0]?.summary).toContain("Earlier session pass");
    expect(archives[0]?.summary).toContain("Later session pass");
    expect(archives[0]?.keyDecisions).toEqual(
      expect.arrayContaining([
        "keep pipeline staging explicit",
        "merge archive entries by concrete scope",
      ]),
    );
    expect(archives[0]?.unresolvedItems).toEqual(
      expect.arrayContaining([
        "finalize archive merge",
        "ship regression coverage",
      ]),
    );
    expect(archives[0]?.referencedArtifacts).toEqual(
      expect.arrayContaining(["maintenance", "archive", "pipeline", "salvage"]),
    );
  });

  it("preserves episode scope when broader maintenance runs consolidate workspace episodes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const runScope = { userId: "u-1" };
    const workspaceScope = { userId: "u-1", workspaceId: "workspace-a", agentId: "agent-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-scope-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-1",
        summary: "Workspace episode one captured archive backfill behavior.",
        topics: ["archive", "backfill", "maintenance"],
        unresolvedItems: ["preserve workspace lineage"],
        keyDecisions: ["run maintenance from user scope"],
        importance: 0.8,
        confidence: 0.9,
        createdAt: "2026-03-30T00:00:00.000Z",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-scope-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        agentId: "agent-a",
        sessionId: "s-2",
        summary: "Workspace episode two continued the same maintenance thread.",
        topics: ["archive", "maintenance", "scope"],
        unresolvedItems: ["verify scoped archive recall"],
        keyDecisions: ["keep workspace isolation intact"],
        importance: 0.82,
        confidence: 0.91,
        createdAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(runScope, ["consolidation"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const workspaceEpisodes = await repositories.episodes.listByScope(workspaceScope);
    const workspaceArchives = await repositories.archives.listByScope(workspaceScope);

    expect(workspaceEpisodes).toHaveLength(3);
    expect(workspaceEpisodes.filter((episode) => !episode.archivedAt)).toHaveLength(1);
    expect(workspaceArchives).toHaveLength(2);
    expect(workspaceArchives.every((archive) => archive.workspaceId === "workspace-a")).toBe(true);
    expect(workspaceArchives.every((archive) => archive.agentId === "agent-a")).toBe(true);
  });
});
