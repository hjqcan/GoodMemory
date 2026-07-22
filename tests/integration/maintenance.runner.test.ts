import { describe, expect, it } from "bun:test";
import {
  createEpisodeMemory,
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import {
  createMaintenanceRunner,
} from "../../src/maintenance/runner";
import {
  createLanguageService,
  type LanguageService,
} from "../../src/language";
import {
  buildMemoryQualityRepairAttributes,
} from "../../src/maintenance/qualityRepairSignals";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";

function createFixture(input?: {
  language?: LanguageService;
  withEmbeddings?: boolean;
}) {
  const documentStore = createInMemoryDocumentStore();
  const embeddingAdapter = input?.withEmbeddings
    ? createFakeEmbeddingAdapter()
    : undefined;
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore: createInMemorySessionStore(),
    vectorStore: input?.withEmbeddings ? createInMemoryVectorStore() : undefined,
  });
  const runner = createMaintenanceRunner({
    embedding: embeddingAdapter,
    language: input?.language,
    repositories,
    vectorIndex: repositories.vectorIndex,
    now: () => "2026-04-02T00:00:00.000Z",
  });

  return {
    embeddingAdapter,
    repositories,
    runner,
  };
}

describe("maintenance runner", () => {
  it("consolidates duplicate active facts safely and idempotently", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-02-01T00:00:00.000Z" },
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    const firstRun = await runner.run(scope, ["dedupe"]);
    expect(firstRun.jobs[0]?.applied).toBe(1);

    const facts = await repositories.facts.listByScope(scope);
    expect(facts.filter((fact) => fact.lifecycle === "active")).toHaveLength(1);
    expect(facts.filter((fact) => fact.lifecycle === "superseded")).toHaveLength(1);

    const secondRun = await runner.run(scope, ["dedupe"]);
    expect(secondRun.jobs[0]?.applied).toBe(0);
  });

  it("repairs safe contradictions by inactivating weaker inferred facts", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "inferred", extractedAt: "2026-02-01T00:00:00.000Z" },
        confidence: 0.6,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is stable after prod migration.",
        source: { method: "explicit", extractedAt: "2026-03-20T00:00:00.000Z" },
        confidence: 0.95,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["contradiction"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const facts = await repositories.facts.listByScope(scope);
    const repaired = facts.find((fact) => fact.id === "fact-1");
    expect(repaired?.lifecycle).toBe("inactive");
    expect(repaired?.isActive).toBe(false);
  });

  it("prefers newer or verification-safer facts during contradiction repair and records the demotion reason", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-older",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        verificationPressureCount: 3,
        lastVerificationHintAt: "2026-03-15T00:00:00.000Z",
        source: { method: "explicit", extractedAt: "2026-03-01T00:00:00.000Z" },
        confidence: 0.95,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-newer",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is stable after prod migration.",
        source: { method: "explicit", extractedAt: "2026-03-20T00:00:00.000Z" },
        confidence: 0.95,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["contradiction"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const facts = await repositories.facts.listByScope(scope);
    const older = facts.find((fact) => fact.id === "fact-older");
    const newer = facts.find((fact) => fact.id === "fact-newer");

    expect(older?.lifecycle).toBe("inactive");
    expect(older?.isActive).toBe(false);
    expect(older?.demotionReason).toBe("contradicted_by_stronger_fact");
    expect(older?.demotedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(newer?.lifecycle).toBe("active");
    expect(newer?.isActive).toBe(true);
  });

  it("can run selected jobs or all jobs through one entry point", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-2",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Robot workflow is blocked on prod migration.",
        source: { method: "explicit", extractedAt: "2026-02-01T00:00:00.000Z" },
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    const selected = await runner.run(scope, ["dedupe"]);
    expect(selected.jobs).toHaveLength(1);
    expect(selected.jobs[0]?.name).toBe("dedupe");

    const all = await runner.run(scope);
    expect(all.jobs.map((job) => job.name)).toEqual([
      "ttlExpiry",
      "projectionRepair",
      "dedupe",
      "contradiction",
      "consolidation",
      "embeddingRepair",
    ]);
  });

  it("persists append-only maintenance telemetry after each run", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-telemetry", workspaceId: "workspace-a" };

    const report = await runner.run(scope, ["dedupe"]);
    const experiences = await repositories.experiences.listByScope(scope);

    expect(report.jobs[0]?.name).toBe("dedupe");
    expect(report.jobs[0]?.applied).toBe(0);
    expect(experiences).toHaveLength(1);
    expect(experiences[0]?.kind).toBe("maintenance");
    expect(experiences[0]?.trigger).toBe("maintenance");
    expect(experiences[0]?.outcome).toBe("skipped");
    expect(experiences[0]?.summary).toContain("dedupe=0");
  });

  it("does not fail the run when telemetry persistence fails after maintenance mutations", async () => {
    const scope = { userId: "u-telemetry-failure", workspaceId: "workspace-a" };
    const { repositories: baseRepositories } = createFixture();
    const repositories = {
      ...baseRepositories,
      experiences: {
        ...baseRepositories.experiences,
        async add() {
          throw new Error("telemetry unavailable");
        },
      },
    };
    const runner = createMaintenanceRunner({
      repositories,
      now: () => "2026-04-02T00:00:00.000Z",
    });

    await baseRepositories.facts.add(
      createFactMemory({
        id: "fact-telemetry-1",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "Rollout is blocked on prod verification.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await baseRepositories.facts.add(
      createFactMemory({
        id: "fact-telemetry-2",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "Rollout is blocked on prod verification.",
        source: { method: "explicit", extractedAt: "2026-02-01T00:00:00.000Z" },
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const report = await runner.run(scope, ["dedupe"]);
      const facts = await baseRepositories.facts.listByScope(scope);
      const experiences = await baseRepositories.experiences.listByScope(scope);

      expect(report.jobs[0]?.applied).toBe(1);
      expect(facts.filter((fact) => fact.lifecycle === "active")).toHaveLength(1);
      expect(facts.filter((fact) => fact.lifecycle === "superseded")).toHaveLength(1);
      expect(experiences).toHaveLength(0);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it("dedupes and repairs Chinese facts", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-zh", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh-1",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        content: "迁移流程目前仍然被审批阻塞。",
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "zh-CN",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh-2",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        content: "迁移流程目前仍然被审批阻塞。",
        source: {
          method: "explicit",
          extractedAt: "2026-01-02T00:00:00.000Z",
          locale: "zh-CN",
        },
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-zh-3",
        userId: "u-zh",
        workspaceId: "workspace-a",
        category: "project",
        content: "迁移流程已经稳定。",
        source: {
          method: "explicit",
          extractedAt: "2026-01-03T00:00:00.000Z",
          locale: "zh-CN",
        },
        confidence: 0.95,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      }),
    );

    const dedupe = await runner.run(scope, ["dedupe"]);
    expect(dedupe.jobs[0]?.applied).toBe(1);

    const contradiction = await runner.run(scope, ["contradiction"]);
    expect(contradiction.jobs[0]?.applied).toBe(1);
  });

  it("uses persisted fact locales instead of re-detecting maintenance text", async () => {
    const language = createLanguageService({
      detector: () => "en-US",
      detectorVersion: "forced-english-for-regression",
    });
    const { repositories, runner } = createFixture({ language });
    const scope = { userId: "u-ja", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-ja-negative",
        userId: "u-ja",
        workspaceId: "workspace-a",
        category: "project",
        content: "ワークフローの移行は未完了です。",
        source: {
          method: "inferred",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "ja-JP",
        },
        confidence: 0.6,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-ja-positive",
        userId: "u-ja",
        workspaceId: "workspace-a",
        category: "project",
        content: "ワークフローの移行は完了しました。",
        source: {
          method: "explicit",
          extractedAt: "2026-03-20T00:00:00.000Z",
          locale: "ja-JP",
        },
        confidence: 0.95,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["contradiction"]);

    expect(report.jobs[0]?.applied).toBe(1);
  });

  it("repairs missing fact, reference, and episode embeddings through maintenance hooks", async () => {
    const { embeddingAdapter, repositories, runner } = createFixture({
      withEmbeddings: true,
    });
    const scope = { userId: "u-1", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Runtime rollout is blocked on vendor approval.",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runtime runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        summary: "Conversation covered runtime rollout continuity.",
        keyDecisions: ["Use the runtime runbook."],
        unresolvedItems: ["Confirm vendor approval."],
        topics: ["runtime rollout"],
      }),
    );

    const report = await runner.run(scope, ["embeddingRepair"]);
    expect(report.jobs[0]?.applied).toBe(3);

    const [factEmbedding] = await embeddingAdapter!.embed([
      "Runtime rollout is blocked on vendor approval.",
    ]);
    const [referenceEmbedding] = await embeddingAdapter!.embed([
      "Runtime runbook\ndocs/runtime-runbook.md",
    ]);
    const [episodeEmbedding] = await embeddingAdapter!.embed([
      [
        "Conversation covered runtime rollout continuity.",
        "Use the runtime runbook.",
        "Confirm vendor approval.",
        "runtime rollout",
      ].join("\n"),
    ]);

    expect(
      await repositories.vectorIndex?.searchFactEmbedding(factEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding(referenceEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding(episodeEmbedding, {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
  });

  it("builds a vector for the consolidated episode when running consolidation as a selected job", async () => {
    const { embeddingAdapter, repositories, runner } = createFixture({
      withEmbeddings: true,
    });
    const scope = { userId: "u-consolidate", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-left",
        userId: "u-consolidate",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Left episode summary.",
        keyDecisions: ["Use the release checklist."],
        unresolvedItems: ["Confirm signoff."],
        topics: ["release rollout"],
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-right",
        userId: "u-consolidate",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        summary: "Right episode summary.",
        keyDecisions: ["Use the release checklist."],
        unresolvedItems: ["Confirm signoff."],
        topics: ["release rollout"],
      }),
    );

    const report = await runner.run(scope, ["consolidation"]);
    expect(report.jobs[0]?.applied).toBe(1);

    const episodes = await repositories.episodes.listByScope(scope);
    const consolidated = episodes.find((episode) => episode.summary.startsWith("Consolidated:"));
    expect(consolidated).toBeTruthy();

    const [embedding] = await embeddingAdapter!.embed([
      [
        consolidated?.summary ?? "",
        consolidated?.keyDecisions.join("\n") ?? "",
        consolidated?.unresolvedItems.join("\n") ?? "",
        consolidated?.topics.join("\n") ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    ]);

    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding(embedding, {
        topK: 5,
        filter: { userId: "u-consolidate", workspaceId: "workspace-a" },
      }),
    ).toContainEqual(expect.objectContaining({ id: consolidated?.id }));
  });

  it("does not consolidate episodes whose persisted locales are incompatible", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-multilingual", workspaceId: "workspace-a" };

    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-ja",
        userId: "u-multilingual",
        workspaceId: "workspace-a",
        summary: "Japanese API rollout discussion.",
        topics: ["API rollout"],
        locale: "ja-JP",
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-zh",
        userId: "u-multilingual",
        workspaceId: "workspace-a",
        summary: "Traditional Chinese API rollout discussion.",
        topics: ["API rollout"],
        locale: "zh-TW",
      }),
    );

    const report = await runner.run(scope, ["consolidation"]);

    expect(report.jobs[0]?.applied).toBe(0);
    expect(
      (await repositories.episodes.listByScope(scope)).filter(
        (episode) => !episode.archivedAt,
      ),
    ).toHaveLength(2);
  });

  it("uses repositories.vectorIndex by default so legacy maintenance wiring still cleans stale vectors", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const runner = createMaintenanceRunner({
      repositories,
      embedding: embeddingAdapter,
      now: () => "2026-04-02T00:00:00.000Z",
    });
    const scope = { userId: "u-legacy", workspaceId: "workspace-a" };
    const factOne = createFactMemory({
      id: "fact-legacy-1",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Runtime rollout is blocked on vendor approval.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const factTwo = createFactMemory({
      id: "fact-legacy-2",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Runtime rollout is blocked on vendor approval.",
      source: { method: "explicit", extractedAt: "2026-02-01T00:00:00.000Z" },
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    await repositories.facts.add(factOne);
    await repositories.facts.add(factTwo);

    const [embedding] = await embeddingAdapter.embed([factOne.content]);
    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        id: factOne.id,
        embedding,
        metadata: { userId: scope.userId, workspaceId: scope.workspaceId, memoryType: "fact" },
        content: factOne.content,
      },
      {
        id: factTwo.id,
        embedding,
        metadata: { userId: scope.userId, workspaceId: scope.workspaceId, memoryType: "fact" },
        content: factTwo.content,
      },
    ]);

    const report = await runner.run(scope, ["dedupe"]);

    expect(report.jobs[0]?.applied).toBe(1);
    expect(await repositories.vectorIndex?.getFactEmbedding(factOne.id)).toBeNull();
    expect(await repositories.vectorIndex?.getFactEmbedding(factTwo.id)).not.toBeNull();
  });

  it("demotes stale inferred action facts while preserving explicit identity continuity", async () => {
    const { embeddingAdapter, repositories, runner } = createFixture({
      withEmbeddings: true,
    });
    const scope = { userId: "u-phase46-stale", workspaceId: "workspace-a" };
    const activeFact = createFactMemory({
      id: "fact-current-blocker",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Reference product launch is blocked by package evidence refresh.",
      confidence: 0.92,
      importance: 0.8,
      source: { method: "explicit", extractedAt: "2026-03-25T00:00:00.000Z" },
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });
    const staleFact = createFactMemory({
      id: "fact-stale-blocker",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Reference product launch is blocked by the old security review.",
      attributes: buildMemoryQualityRepairAttributes({
        failureLabel: "stale_recall",
        phase: "phase-46",
        replacementMemoryId: activeFact.id,
        sampleId: "phase46-sample-stale-recall",
        source: "quality_repair_guardrail",
        sourceScenario: "historical-task-continuation",
      }),
      confidence: 0.58,
      importance: 0.35,
      verificationPressureCount: 3,
      lastVerificationHintAt: "2026-03-30T00:00:00.000Z",
      source: { method: "inferred", extractedAt: "2025-12-01T00:00:00.000Z" },
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    const identityFact = createFactMemory({
      id: "fact-identity",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "personal",
      content: "The user prefers precise architecture reviews.",
      confidence: 0.95,
      importance: 0.9,
      source: { method: "explicit", extractedAt: "2025-12-01T00:00:00.000Z" },
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    });

    await repositories.facts.add(staleFact);
    await repositories.facts.add(activeFact);
    await repositories.facts.add(identityFact);
    const [staleEmbedding] = await embeddingAdapter!.embed([
      staleFact.content,
    ]);
    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        id: staleFact.id,
        embedding: staleEmbedding,
        metadata: { userId: scope.userId, workspaceId: scope.workspaceId, memoryType: "fact" },
        content: staleFact.content,
      },
    ]);

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 1 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === staleFact.id)).toMatchObject({
      demotionReason: "stale_action_quality_repair",
      isActive: false,
      lifecycle: "inactive",
    });
    expect(facts.find((fact) => fact.id === activeFact.id)?.lifecycle).toBe("active");
    expect(facts.find((fact) => fact.id === identityFact.id)?.lifecycle).toBe("active");
    expect(await repositories.vectorIndex?.getFactEmbedding(staleFact.id)).toBeNull();
  });

  it("preserves pressured stale inferred action facts without a current replacement", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-phase46-stale-no-replacement", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-only-stale-blocker",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "Reference product launch is blocked by old security review.",
        confidence: 0.58,
        importance: 0.35,
        verificationPressureCount: 3,
        lastVerificationHintAt: "2026-03-30T00:00:00.000Z",
        source: { method: "inferred", extractedAt: "2025-12-01T00:00:00.000Z" },
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 0 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === "fact-only-stale-blocker")).toMatchObject({
      isActive: true,
      lifecycle: "active",
    });
  });

  it("analyzes each fact once while evaluating stale action replacements", async () => {
    const baseLanguage = createLanguageService();
    const analysisCalls = new Map<string, number>();
    const language: LanguageService = {
      ...baseLanguage,
      analyzeContent(content, context) {
        analysisCalls.set(content, (analysisCalls.get(content) ?? 0) + 1);
        return {
          ...baseLanguage.analyzeContent(content, context),
          blockerFact: false,
          focusFact: false,
          openLoopFact: false,
          projectStateFact: true,
        };
      },
    };
    const { repositories, runner } = createFixture({ language });
    const scope = {
      userId: "u-quality-analysis",
      workspaceId: "workspace-a",
    };
    const replacement = createFactMemory({
      id: "fact-current-state",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Atlas rollout is in its current state.",
      confidence: 0.9,
      importance: 0.8,
      source: { method: "explicit", extractedAt: "2026-03-25T00:00:00.000Z" },
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });
    const stale = createFactMemory({
      id: "fact-stale-state",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Atlas rollout was in its old state.",
      attributes: buildMemoryQualityRepairAttributes({
        failureLabel: "stale_recall",
        replacementMemoryId: replacement.id,
        sampleId: "quality-analysis-once",
        source: "quality_repair_guardrail",
        sourceScenario: "maintenance-analysis-cache",
      }),
      confidence: 0.5,
      importance: 0.3,
      verificationPressureCount: 3,
      source: { method: "inferred", extractedAt: "2025-12-01T00:00:00.000Z" },
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    await repositories.facts.add(replacement);
    await repositories.facts.add(stale);

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 1 }]);
    expect(analysisCalls).toEqual(new Map([
      [stale.content, 1],
      [replacement.content, 1],
    ]));
  });

  it("re-checks stale repair replacements after same-run quality demotions", async () => {
    const { repositories, runner } = createFixture();
    const scope = {
      userId: "u-phase46-stale-demoted-replacement",
      workspaceId: "workspace-a",
    };
    const replacement = createFactMemory({
      id: "fact-demoted-replacement",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Reference product launch is blocked by a redacted private note.",
      attributes: buildMemoryQualityRepairAttributes({
        failureLabel: "over_remembering",
        phase: "phase-46",
        reviewOutcome: "false_write",
        sampleId: "phase46-sample-demoted-replacement",
        source: "quality_failure_sample",
        sourceScenario: "observe-writeback-candidate-visibility",
      }),
      confidence: 0.92,
      importance: 0.8,
      source: { method: "explicit", extractedAt: "2026-03-25T00:00:00.000Z" },
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });
    const staleFact = createFactMemory({
      id: "fact-stale-blocker-with-bad-replacement",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Reference product launch is blocked by the old security review.",
      attributes: buildMemoryQualityRepairAttributes({
        failureLabel: "stale_recall",
        phase: "phase-46",
        replacementMemoryId: replacement.id,
        sampleId: "phase46-sample-stale-recall-demoted-replacement",
        source: "quality_repair_guardrail",
        sourceScenario: "historical-task-continuation",
      }),
      confidence: 0.58,
      importance: 0.35,
      verificationPressureCount: 3,
      lastVerificationHintAt: "2026-03-30T00:00:00.000Z",
      source: { method: "inferred", extractedAt: "2025-12-01T00:00:00.000Z" },
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    });

    await repositories.facts.add(staleFact);
    await repositories.facts.add(replacement);

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 1 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === replacement.id)).toMatchObject({
      demotionReason: "over_remembering_quality_repair",
      lifecycle: "inactive",
    });
    expect(facts.find((fact) => fact.id === staleFact.id)).toMatchObject({
      isActive: true,
      lifecycle: "active",
    });
  });

  it("demotes unsafe or noisy over-remembered facts without raw transcript inspection", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-phase46-over-memory", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-private-leak",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "technical",
        content: "Redacted private credential should not be recalled.",
        tags: ["installed-host-writeback"],
        attributes: buildMemoryQualityRepairAttributes({
          failureLabel: "over_remembering",
          reviewOutcome: "false_write",
          phase: "phase-46",
          sampleId: "phase46-sample-over-remembering",
          source: "quality_failure_sample",
          sourceScenario: "observe-writeback-candidate-visibility",
        }),
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-useful-launch-note",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "Launch note candidate was reviewed and accepted.",
        tags: ["installed-host-writeback"],
        attributes: {
          writebackReviewOutcome: "accepted_as_useful",
        },
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-unrelated-rejected-state",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "The unrelated proposal status was rejected.",
        attributes: {
          proposalStatus: "rejected",
        },
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-unrelated-review-outcome",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "The unrelated design review outcome was rejected.",
        attributes: {
          reviewOutcome: "rejected",
        },
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 1 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === "fact-private-leak")).toMatchObject({
      demotionReason: "over_remembering_quality_repair",
      isActive: false,
      lifecycle: "inactive",
    });
    expect(facts.find((fact) => fact.id === "fact-useful-launch-note")?.lifecycle).toBe("active");
    expect(facts.find((fact) => fact.id === "fact-unrelated-rejected-state")?.lifecycle).toBe("active");
    expect(facts.find((fact) => fact.id === "fact-unrelated-review-outcome")?.lifecycle).toBe("active");
  });

  it("preserves quality-marked facts without an explicit demotive review outcome", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-phase46-review-required", workspaceId: "workspace-a" };

    await repositories.facts.add(
      createFactMemory({
        id: "fact-quality-missing-review",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "technical",
        content: "A quality sample without a review outcome must remain active.",
        attributes: buildMemoryQualityRepairAttributes({
          failureLabel: "over_remembering",
          phase: "phase-46",
          sampleId: "phase46-sample-over-remembering-unreviewed",
          source: "quality_failure_sample",
          sourceScenario: "observe-writeback-candidate-visibility",
        }),
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "fact-quality-uncertain-review",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "technical",
        content: "A quality sample with uncertain review must remain active.",
        attributes: buildMemoryQualityRepairAttributes({
          failureLabel: "noisy_procedural_memory",
          phase: "phase-46",
          reviewOutcome: "uncertain",
          sampleId: "phase46-sample-noisy-procedural-uncertain",
          source: "quality_failure_sample",
          sourceScenario: "observe-writeback-candidate-visibility",
        }),
        source: { method: "explicit", extractedAt: "2026-03-31T00:00:00.000Z" },
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 0 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === "fact-quality-missing-review")).toMatchObject({
      isActive: true,
      lifecycle: "active",
    });
    expect(facts.find((fact) => fact.id === "fact-quality-uncertain-review")).toMatchObject({
      isActive: true,
      lifecycle: "active",
    });
  });

  it("preserves recently used inferred action facts to avoid missed recall", async () => {
    const { repositories, runner } = createFixture();
    const scope = { userId: "u-phase46-recent", workspaceId: "workspace-a" };
    const replacementFact = createFactMemory({
      id: "fact-recent-current-blocker",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      category: "project",
      content: "Reference product launch is blocked by package evidence refresh.",
      confidence: 0.92,
      importance: 0.8,
      source: { method: "explicit", extractedAt: "2026-03-25T00:00:00.000Z" },
      createdAt: "2026-03-25T00:00:00.000Z",
      updatedAt: "2026-03-25T00:00:00.000Z",
    });

    await repositories.facts.add(replacementFact);
    await repositories.facts.add(
      createFactMemory({
        id: "fact-recently-used-blocker",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content: "Reference product launch is blocked by release signoff.",
        attributes: buildMemoryQualityRepairAttributes({
          failureLabel: "stale_recall",
          phase: "phase-46",
          replacementMemoryId: replacementFact.id,
          sampleId: "phase46-sample-recently-used-stale-recall",
          source: "quality_repair_guardrail",
          sourceScenario: "historical-task-continuation",
        }),
        confidence: 0.58,
        importance: 0.35,
        accessCount: 4,
        lastAccessedAt: "2026-03-25T00:00:00.000Z",
        verificationPressureCount: 3,
        lastVerificationHintAt: "2026-03-30T00:00:00.000Z",
        source: { method: "inferred", extractedAt: "2025-12-01T00:00:00.000Z" },
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2025-12-01T00:00:00.000Z",
      }),
    );

    const report = await runner.run(scope, ["qualityRepair"]);

    expect(report.jobs).toEqual([{ name: "qualityRepair", applied: 0 }]);
    const facts = await repositories.facts.listByScope(scope);
    expect(facts.find((fact) => fact.id === "fact-recently-used-blocker")).toMatchObject({
      isActive: true,
      lifecycle: "active",
    });
  });

  it("removes stale vectors for superseded, inactive, and archived memory during embedding repair", async () => {
    const { embeddingAdapter, repositories, runner } = createFixture({
      withEmbeddings: true,
    });
    const scope = { userId: "u-stale", workspaceId: "workspace-a" };

    const staleFact = createFactMemory({
      id: "fact-stale",
      userId: "u-stale",
      workspaceId: "workspace-a",
      category: "project",
      content: "Runtime rollout is blocked on vendor approval.",
      lifecycle: "superseded",
      isActive: false,
      source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
    });
    const staleReference = createReferenceMemory({
      id: "ref-stale",
      userId: "u-stale",
      workspaceId: "workspace-a",
      title: "Old runtime runbook",
      pointer: "docs/runtime-runbook-v1.md",
      lifecycle: "inactive",
      source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
    });
    const staleEpisode = createEpisodeMemory({
      id: "ep-stale",
      userId: "u-stale",
      workspaceId: "workspace-a",
      summary: "Old runtime continuity thread.",
      topics: ["runtime rollout"],
      archivedAt: "2026-04-01T00:00:00.000Z",
    });
    const activeFact = createFactMemory({
      id: "fact-active",
      userId: "u-stale",
      workspaceId: "workspace-a",
      category: "project",
      content: "Current blocker is security review.",
      source: { method: "explicit", extractedAt: "2026-04-02T00:00:00.000Z" },
    });

    await repositories.facts.add(staleFact);
    await repositories.references.add(staleReference);
    await repositories.episodes.add(staleEpisode);
    await repositories.facts.add(activeFact);

    const [staleFactEmbedding] = await embeddingAdapter!.embed([staleFact.content]);
    const [staleReferenceEmbedding] = await embeddingAdapter!.embed([
      `${staleReference.title}\n${staleReference.pointer}`,
    ]);
    const [staleEpisodeEmbedding] = await embeddingAdapter!.embed([
      [staleEpisode.summary, staleEpisode.topics.join("\n")].filter(Boolean).join("\n"),
    ]);

    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        id: staleFact.id,
        embedding: staleFactEmbedding,
        metadata: { userId: "u-stale", workspaceId: "workspace-a", memoryType: "fact" },
        content: staleFact.content,
      },
    ]);
    await repositories.vectorIndex?.upsertReferenceEmbedding([
      {
        id: staleReference.id,
        embedding: staleReferenceEmbedding,
        metadata: { userId: "u-stale", workspaceId: "workspace-a", memoryType: "reference" },
        content: `${staleReference.title}\n${staleReference.pointer}`,
      },
    ]);
    await repositories.vectorIndex?.upsertEpisodeEmbedding([
      {
        id: staleEpisode.id,
        embedding: staleEpisodeEmbedding,
        metadata: { userId: "u-stale", workspaceId: "workspace-a", memoryType: "episode" },
        content: [staleEpisode.summary, staleEpisode.topics.join("\n")].filter(Boolean).join(
          "\n",
        ),
      },
    ]);

    await runner.run(scope, ["embeddingRepair"]);

    expect(
      await repositories.vectorIndex?.searchFactEmbedding(staleFactEmbedding, {
        topK: 5,
        filter: { userId: "u-stale", workspaceId: "workspace-a" },
      }),
    ).not.toContainEqual(expect.objectContaining({ id: staleFact.id }));
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding(staleReferenceEmbedding, {
        topK: 5,
        filter: { userId: "u-stale", workspaceId: "workspace-a" },
      }),
    ).not.toContainEqual(expect.objectContaining({ id: staleReference.id }));
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding(staleEpisodeEmbedding, {
        topK: 5,
        filter: { userId: "u-stale", workspaceId: "workspace-a" },
      }),
    ).not.toContainEqual(expect.objectContaining({ id: staleEpisode.id }));
  });

  it("treats legacy references without lifecycle as active during embedding repair", async () => {
    const { embeddingAdapter, repositories, runner } = createFixture({
      withEmbeddings: true,
    });
    const scope = { userId: "u-legacy-reference", workspaceId: "workspace-a" };
    const legacyReference = createReferenceMemory({
      id: "ref-legacy-active",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      title: "Runtime runbook",
      pointer: "docs/runtime-runbook.md",
      source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
    });
    delete (legacyReference as Partial<typeof legacyReference>).lifecycle;
    await repositories.references.add(legacyReference);
    const [referenceEmbedding] = await embeddingAdapter!.embed([
      `${legacyReference.title}\n${legacyReference.pointer}`,
    ]);
    await repositories.vectorIndex?.upsertReferenceEmbedding([
      {
        id: legacyReference.id,
        embedding: referenceEmbedding,
        metadata: {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          memoryType: "reference",
        },
        content: `${legacyReference.title}\n${legacyReference.pointer}`,
      },
    ]);

    const report = await runner.run(scope, ["embeddingRepair"]);

    expect(report.jobs[0]?.applied).toBe(1);
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding(referenceEmbedding, {
        topK: 5,
        filter: { userId: scope.userId, workspaceId: scope.workspaceId },
      }),
    ).toContainEqual(expect.objectContaining({ id: legacyReference.id }));
  });
});
