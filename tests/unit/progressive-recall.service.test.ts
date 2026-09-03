import { describe, expect, it } from "bun:test";
import type {
  ExportMemoryResult,
  RecallInput,
  RecallResult,
} from "../../src/api/contracts";
import type { MemoryScope } from "../../src/domain/scope";
import {
  createProgressiveRecallService,
  encodeGoodMemoryRecordRef,
  parseGoodMemoryRecordRef,
} from "../../src/progressive/recall";
import { createLanguageService } from "../../src/language";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

const scope: MemoryScope = {
  agentId: "codex",
  sessionId: "session-secret",
  tenantId: "tenant-secret",
  userId: "user-secret",
  workspaceId: "workspace-secret",
};
const language = createLanguageService();

function createExportedMemory(): ExportMemoryResult {
  return {
    pages: buildPageArtifacts({ notes: [] }),
    artifacts: {
      files: [],
      rootPath: ".",
    },
    durable: {
      archives: [
        {
          archivedAt: "2026-01-03T00:00:00.000Z",
          createdAt: "2026-01-03T00:00:00.000Z",
          id: "archive-1",
          keyDecisions: ["Keep progressive recall as a shared service."],
          normalizedTranscript: "raw user transcript must stay hidden",
          referencedArtifacts: [],
          scopeLineage: [],
          sessionId: "session-secret",
          sourceSessionIds: ["session-secret"],
          summary: "Progressive recall design session.",
          unresolvedItems: ["Add MCP adapter after service lands."],
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      ],
      episodes: [],
      evidence: [
        {
          agentId: scope.agentId,
          createdAt: "2026-01-02T00:00:00.000Z",
          excerpt: "Observed release blocker in the quality gate output.",
          id: "evidence-1",
          kind: "tool_result_excerpt",
          linkedArchiveIds: [],
          linkedMemoryIds: ["fact-1"],
          source: {
            extractedAt: "2026-01-02T00:00:00.000Z",
            method: "explicit",
          },
          sourceMessageIds: [],
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      ],
      experiences: [],
      facts: [
        {
          category: "project",
          confidence: 1,
          content: "The release quality gate is blocked on package evidence.",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "fact-1",
          importance: 1,
          isActive: true,
          lifecycle: "active",
          occurrence: {
            start: "2025-12-30T16:00:00.000Z",
            endExclusive: "2025-12-31T16:00:00.000Z",
            precision: "day",
            timezone: "Asia/Shanghai",
          },
          source: {
            extractedAt: "2026-01-01T00:00:00.000Z",
            method: "explicit",
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      ],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [
        {
          confidence: 1,
          createdAt: "2026-01-01T01:00:00.000Z",
          id: "reference-1",
          pointer: "docs/release-evidence.md",
          source: {
            extractedAt: "2026-01-01T01:00:00.000Z",
            method: "explicit",
          },
          title: "Release evidence runbook",
          updatedAt: "2026-01-01T01:00:00.000Z",
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      ],
    },
    exportedAt: "2026-01-04T00:00:00.000Z",
    runtime: {
      journal: {
        currentState: "Building the progressive recall service.",
        errorsAndCorrections: [],
        filesAndFunctions: [],
        keyResults: [],
        learnings: ["MCP should wrap the shared service."],
        sessionId: "session-secret",
        systemDocumentation: [],
        updatedAt: "2026-01-04T00:00:00.000Z",
        userId: scope.userId,
        workflow: [],
        worklog: ["Sketched Phase 42 service boundaries."],
      },
      spills: [],
      workingMemory: null,
    },
    scope,
  };
}

function createMemory(
  exported: ExportMemoryResult,
  options: { recall?: Partial<RecallResult> } = {},
) {
  return {
    async exportMemory(input: { includeRuntime?: boolean; scope: MemoryScope }) {
      return {
        ...exported,
        runtime: input.includeRuntime === true ? exported.runtime : undefined,
        scope: input.scope,
      };
    },
    async recall(input: RecallInput): Promise<RecallResult> {
      const base: RecallResult = {
        archives: exported.durable.archives,
        episodes: exported.durable.episodes,
        evidence: exported.durable.evidence,
        facts: exported.durable.facts,
        feedback: exported.durable.feedback,
        journal: exported.runtime?.journal ?? null,
        metadata: {
          candidateTraces: [],
          hits: [],
          latencyMs: 0,
          policyApplied: [],
          routingDecision: {
            actionDriving: false,
            continuation: false,
            intent: "general_assistance",
            referenceSeeking: false,
            requestedSlots: [],
            retrievalProfile: "general_chat",
            sourcePriorities: [],
            strategy: "rules-only",
            strategyExplanation: {
              hardFloor: "lexical_runtime_procedural_priors",
              llmRefinement: false,
              requestedStrategy: "rules-only",
              resolvedStrategy: "rules-only",
              semanticTieBreaking: false,
              summary: "unit test routing",
            },
            supportSlots: [],
          },
          tokenCount: 0,
          verificationHints: [],
        },
        packet: {},
        preferences: exported.durable.preferences,
        profile: exported.durable.profile,
        references: exported.durable.references,
        notes: [],
        workingMemory: exported.runtime?.workingMemory ?? null,
      };

      return {
        ...base,
        ...options.recall,
      };
    },
  };
}

describe("ProgressiveRecallService", () => {
  it("ranks Traditional Chinese and Japanese records with pack tokenization", async () => {
    const exported = createExportedMemory();
    exported.durable.facts = [
      {
        ...exported.durable.facts[0]!,
        content: "部署品質閘門仍在等待套件證據。",
        id: "fact-hant",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        ...exported.durable.facts[0]!,
        content: "リリース品質ゲートはパッケージ証拠を待っています。",
        id: "fact-ja",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(exported),
      scopeDigestSecret: "progressive-test-secret",
    });

    const hant = await service.searchRecallIndex({
      locale: "zh-TW",
      query: "品質閘門",
      scope,
    });
    const japanese = await service.searchRecallIndex({
      locale: "ja-JP",
      query: "品質ゲート",
      scope,
    });

    expect(hant.records[0]?.summary).toContain("品質閘門");
    expect(hant.records[0]?.score).toBeGreaterThan(0);
    expect(hant.records[0]?.title).toStartWith("事實:");
    expect(japanese.records[0]?.summary).toContain("品質ゲート");
    expect(japanese.records[0]?.score).toBeGreaterThan(0);
    expect(japanese.records[0]?.title).toStartWith("事実:");
    expect(service.renderProgressiveContext({ index: japanese }).content)
      .toContain("段階的 GoodMemory リコール");
  });

  it("passes an explicit locale through progressive recall", async () => {
    let capturedLocale: string | undefined;
    const base = createMemory(createExportedMemory());
    const memory = {
      async recall(input: RecallInput) {
        capturedLocale = input.locale;
        return base.recall(input);
      },
    };
    const service = createProgressiveRecallService({
      language,
      memory,
      scopeDigestSecret: "progressive-test-secret",
    });

    await service.searchRecallIndex({
      locale: "ja-JP",
      query: "再開する作業コンテキスト",
      scope,
    });

    expect(capturedLocale).toBe("ja-JP");
  });

  it("passes temporal context through search and timeline recall", async () => {
    const captured: RecallInput[] = [];
    const base = createMemory(createExportedMemory());
    const service = createProgressiveRecallService({
      language,
      memory: {
        async recall(input: RecallInput) {
          captured.push(input);
          return base.recall(input);
        },
      },
      scopeDigestSecret: "progressive-test-secret",
    });
    const temporal = {
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    };

    await service.searchRecallIndex({
      query: "What happened yesterday?",
      scope,
      ...temporal,
    });
    await service.buildRecallTimeline({
      query: "What happened yesterday?",
      scope,
      ...temporal,
    });

    expect(captured).toHaveLength(2);
    for (const input of captured) {
      expect(input).toMatchObject(temporal);
    }
  });

  it("buckets event facts by their occurrence timezone without changing other records", async () => {
    const exported = createExportedMemory();
    exported.durable.facts = [{
      ...exported.durable.facts[0]!,
      content: "I ate tomato omelet.",
      occurrence: {
        start: "2026-08-10T16:00:00.000Z",
        endExclusive: "2026-08-11T16:00:00.000Z",
        precision: "day",
        timezone: "Asia/Shanghai",
      },
    }];
    exported.durable.references = [{
      ...exported.durable.references[0]!,
      updatedAt: "2026-08-10T16:00:00.000Z",
    }];
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(exported),
      scopeDigestSecret: "progressive-test-secret",
    });

    const timeline = await service.buildRecallTimeline({
      query: "tomato release evidence",
      scope,
    });
    const factBucket = timeline.buckets.find(({ records }) =>
      records.some(({ recordKind }) => recordKind === "fact")
    );
    const referenceBucket = timeline.buckets.find(({ records }) =>
      records.some(({ recordKind }) => recordKind === "reference")
    );

    expect(factBucket?.label).toBe("2026-08-11");
    expect(referenceBucket?.label).toBe("2026-08-10");
  });

  it("uses occurrence precision in non-day event timeline labels", async () => {
    const exported = createExportedMemory();
    const base = exported.durable.facts[0]!;
    exported.durable.facts = ([
      ["week", "2026-08-10T16:00:00.000Z"],
      ["month", "2026-07-31T16:00:00.000Z"],
      ["quarter", "2026-07-31T16:00:00.000Z"],
      ["year", "2025-12-31T16:00:00.000Z"],
      ["instant", "2026-08-10T16:04:05.000Z"],
    ] as const).map(([precision, start]) => ({
      ...base,
      content: `${precision} temporal event`,
      id: `fact-${precision}`,
      occurrence: {
        start,
        endExclusive: new Date(Date.parse(start) + 1).toISOString(),
        precision,
        timezone: "Asia/Shanghai",
      },
    }));
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(exported),
      scopeDigestSecret: "progressive-test-secret",
    });
    const timeline = await service.buildRecallTimeline({
      query: "temporal event",
      scope,
    });
    const labelFor = (summary: string) => timeline.buckets.find(({ records }) =>
      records.some((record) => record.summary === summary)
    )?.label;

    expect(labelFor("week temporal event")).toBe("2026-08-11");
    expect(labelFor("month temporal event")).toBe("2026-08");
    expect(labelFor("quarter temporal event")).toBe("2026-Q3");
    expect(labelFor("year temporal event")).toBe("2026");
    expect(labelFor("instant temporal event")).toBe("2026-08-11T00:04:05");
  });

  it("encodes parseable record refs and rejects malformed bare ids", () => {
    const recordRef = encodeGoodMemoryRecordRef({
      id: "fact:with-colon",
      recordKind: "fact",
      scopeDigest: "scope_abc123",
    });

    expect(recordRef).toBe("gmrec:v1:scope_abc123:fact:fact%3Awith-colon");
    expect(parseGoodMemoryRecordRef(recordRef)).toEqual({
      id: "fact:with-colon",
      recordKind: "fact",
      scopeDigest: "scope_abc123",
    });
    expect(parseGoodMemoryRecordRef("fact-1")).toBeNull();
  });

  it("builds a compact index without leaking raw scope fields", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });

    const index = await service.searchRecallIndex({
      includeRuntime: true,
      query: "release quality evidence",
      scope,
    });

    expect(index.scopeDigest).toMatch(/^scope_[a-f0-9]{32}$/u);
    expect(JSON.stringify(index)).not.toContain(scope.userId);
    expect(JSON.stringify(index)).not.toContain(scope.workspaceId);
    expect(index.records.map((record) => record.recordKind)).toContain("fact");
    expect(index.records.map((record) => record.recordKind)).toContain("reference");
    expect(index.records.map((record) => record.recordKind)).toContain("archive");
    expect(index.records.map((record) => record.recordKind)).toContain("runtime-journal");
    expect(index.records.every((record) => record.recordRef.startsWith("gmrec:v1:"))).toBe(true);
    const factRecord = index.records.find(({ recordKind }) => recordKind === "fact");
    expect(factRecord?.occurredAt).toBe("2025-12-30T16:00:00.000Z");
    const factDetail = await service.getProgressiveRecords({
      recordRefs: [factRecord!.recordRef],
      scope,
    });
    expect(factDetail.records[0]?.detail).toMatchObject({
      occurrence: {
        start: "2025-12-30T16:00:00.000Z",
        endExclusive: "2025-12-31T16:00:00.000Z",
        precision: "day",
        timezone: "Asia/Shanghai",
      },
    });
  });

  it("uses recall-visible records instead of export-only records", async () => {
    const exported = createExportedMemory();
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(exported, {
        recall: {
          facts: [],
        },
      }),
      scopeDigestSecret: "progressive-test-secret",
    });

    const index = await service.searchRecallIndex({
      query: "release quality evidence",
      scope,
    });
    const blockedFactRef = encodeGoodMemoryRecordRef({
      id: "fact-1",
      recordKind: "fact",
      scopeDigest: index.scopeDigest,
    });

    expect(index.records.map((record) => record.recordKind)).not.toContain("fact");
    await expect(
      service.getProgressiveRecords({
        recordRefs: [blockedFactRef],
        scope,
      }),
    ).rejects.toThrow("not available in the current progressive recall visibility set");
  });

  it("does not let constructed refs bypass runtime visibility", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });

    const durableOnlyIndex = await service.searchRecallIndex({
      includeRuntime: false,
      query: "progressive recall",
      scope,
    });
    const runtimeRef = encodeGoodMemoryRecordRef({
      id: "current",
      recordKind: "runtime-journal",
      scopeDigest: durableOnlyIndex.scopeDigest,
    });

    expect(durableOnlyIndex.records.map((record) => record.recordKind)).not.toContain(
      "runtime-journal",
    );
    await expect(
      service.getProgressiveRecords({
        recordRefs: [runtimeRef],
        scope,
      }),
    ).rejects.toThrow("not available in the current progressive recall visibility set");

    const runtimeIndex = await service.searchRecallIndex({
      includeRuntime: true,
      query: "progressive recall",
      scope,
    });
    const visibleRuntimeRef = runtimeIndex.records.find(
      (record) => record.recordKind === "runtime-journal",
    )?.recordRef;
    if (!visibleRuntimeRef) {
      throw new Error("Expected runtime journal ref after runtime-enabled index.");
    }

    const detail = await service.getProgressiveRecords({
      recordRefs: [visibleRuntimeRef],
      scope,
    });
    expect(detail.records[0]?.recordKind).toBe("runtime-journal");

    await service.searchRecallIndex({
      includeRuntime: false,
      query: "progressive recall",
      scope,
    });
    await expect(
      service.getProgressiveRecords({
        recordRefs: [visibleRuntimeRef],
        scope,
      }),
    ).rejects.toThrow("not available in the current progressive recall visibility set");
  });

  it("keeps earlier durable refs available across later progressive index calls", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });
    const index = await service.searchRecallIndex({
      includeRuntime: false,
      query: "release blocker",
      scope,
    });
    const factRef = index.records.find(
      (record) => record.recordKind === "fact",
    )?.recordRef;
    if (!factRef) {
      throw new Error("Expected fact ref in initial progressive index.");
    }

    await service.buildRecallTimeline({
      includeRuntime: false,
      query: "release evidence runbook",
      scope,
    });
    const detail = await service.getProgressiveRecords({
      recordRefs: [factRef],
      scope,
    });

    expect(detail.records[0]).toMatchObject({
      recordKind: "fact",
      recordRef: factRef,
    });
  });

  it("supports detached timeline method calls", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });
    const { buildRecallTimeline } = service;

    const timeline = await buildRecallTimeline({
      includeRuntime: true,
      query: "release evidence",
      scope,
    });

    expect(timeline.buckets.length).toBeGreaterThan(0);
    expect(timeline.scopeDigest).toMatch(/^scope_[a-f0-9]{32}$/u);
  });

  it("fetches detail by recordRef, denies cross-scope refs, and strips raw transcripts", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });
    const index = await service.searchRecallIndex({
      includeRuntime: true,
      query: "progressive recall",
      scope,
    });
    const archiveRef = index.records.find(
      (record) => record.recordKind === "archive",
    )?.recordRef;

    if (!archiveRef) {
      throw new Error("Expected archive ref in progressive index.");
    }

    const detail = await service.getProgressiveRecords({
      recordRefs: [archiveRef],
      scope,
    });
    expect(detail.records).toHaveLength(1);
    expect(detail.records[0]).toMatchObject({
      recordKind: "archive",
      title: "Progressive recall design session.",
    });
    expect(JSON.stringify(detail)).not.toContain("raw user transcript");

    await expect(
      service.getProgressiveRecords({
        recordRefs: [
          encodeGoodMemoryRecordRef({
            id: "archive-1",
            recordKind: "archive",
            scopeDigest: "scope_other",
          }),
        ],
        scope,
      }),
    ).rejects.toThrow("does not belong to the requested scope");
  });

  it("renders progressive context with refs and token costs", async () => {
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(createExportedMemory()),
      scopeDigestSecret: "progressive-test-secret",
    });
    const index = await service.searchRecallIndex({
      includeRuntime: true,
      query: "release evidence",
      scope,
    });

    const rendered = service.renderProgressiveContext({
      index,
      query: "release evidence",
      retrievalProfile: "coding_agent",
    });

    expect(rendered.content).toContain("Progressive GoodMemory Recall");
    expect(rendered.content).toContain("gmrec:v1:");
    expect(rendered.content).toContain("detail tokens");
    expect(rendered.content).toContain("[2025-12-31, Asia/Shanghai]");
    expect(rendered.content).not.toContain(scope.userId);
    expect(rendered.estimatedTokens).toBeLessThan(320);

    const budgeted = service.renderProgressiveContext({
      index,
      maxTokens: 80,
      query: "release evidence",
      retrievalProfile: "coding_agent",
    });
    expect(budgeted.content).toContain("Progressive GoodMemory Recall");
    expect(budgeted.content).toContain("gmrec:v1:");
    expect(budgeted.estimatedTokens).toBeLessThanOrEqual(80);

    const tinyBudget = service.renderProgressiveContext({
      index,
      maxTokens: 3,
      query: "release evidence",
      retrievalProfile: "coding_agent",
    });
    expect(tinyBudget.estimatedTokens).toBeLessThanOrEqual(3);
    expect(tinyBudget.content.length).toBeLessThanOrEqual(12);
  });

  it("keeps working memory visible in progressive runtime context", async () => {
    const exported = createExportedMemory();
    exported.durable.facts = Array.from({ length: 20 }, (_, index) => ({
      ...exported.durable.facts[0]!,
      content: `installed host continuity high scoring durable fact ${index}`,
      id: `fact-ranked-${index}`,
      updatedAt: `2026-01-04T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    exported.runtime = {
      ...exported.runtime!,
      workingMemory: {
        constraints: ["Do not widen the public root API."],
        currentGoal: "Close Phase 42 without losing installed-host continuity.",
        openLoops: ["Run typecheck", "Sync task-board evidence"],
        sessionId: "session-secret",
        temporaryDecisions: ["Use MCP as adapter, not owner."],
        updatedAt: "2026-01-04T01:00:00.000Z",
        userId: scope.userId,
      },
    };
    const service = createProgressiveRecallService({
      language,
      memory: createMemory(exported),
      scopeDigestSecret: "progressive-test-secret",
    });
    const index = await service.searchRecallIndex({
      includeRuntime: true,
      limit: 1,
      query: "installed host continuity",
      scope,
    });
    const workingMemoryTitle = language.render(
      { key: "working_memory" },
      index.locale ?? "en-US",
    );
    const workingMemoryRef = index.records.find(
      (record) => record.title === workingMemoryTitle,
    )?.recordRef;

    if (!workingMemoryRef) {
      throw new Error("Expected working memory ref in progressive index.");
    }

    const detail = await service.getProgressiveRecords({
      recordRefs: [workingMemoryRef],
      scope,
    });
    expect(detail.records[0]).toMatchObject({
      recordKind: "runtime-journal",
      title: workingMemoryTitle,
    });
    expect(JSON.stringify(detail)).toContain("Run typecheck");
    expect(JSON.stringify(detail)).not.toContain(scope.userId);
  });
});
