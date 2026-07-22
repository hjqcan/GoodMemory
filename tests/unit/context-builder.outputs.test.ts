import { describe, expect, it } from "bun:test";
import { attachBehavioralPolicyAttributes } from "../../src/evolution/behavioralPolicy";
import { createLanguageService } from "../../src/language";
import {
  buildMemoryPacket,
  rebuildMemoryPacket,
  renderMemoryPacket,
} from "../../src/recall/contextBuilder";
import { planRecall } from "../../src/recall/router";

describe("context builder output modes", () => {
  it("keeps CJK-only sections within per-call token budgets", () => {
    const rendered = renderMemoryPacket(
      { factSummary: "記憶".repeat(20) },
      "markdown",
      10,
    );

    expect(rendered.estimatedTokens).toBeLessThanOrEqual(10);
    expect(rendered.content).toStartWith("## Facts\n");
  });

  it("enforces the packet maxRenderedTokens limit even for one oversized section", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [{
        id: "fact-large",
        userId: "u-1",
        category: "project",
        content: "x".repeat(30_000),
        confidence: 1,
        importance: 1,
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
        accessCount: 0,
        lifecycle: "active",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      maxRenderedTokens: 6_000,
    });

    const rendered = renderMemoryPacket(packet, "developer_prompt_fragment");

    expect(rendered.estimatedTokens).toBeLessThanOrEqual(6_000);
    expect(Buffer.byteLength(rendered.content, "utf8")).toBeLessThanOrEqual(6_000);
    expect(rendered.content).not.toContain("x".repeat(30_000));
    const json = renderMemoryPacket(packet, "json");
    expect(json.estimatedTokens).toBeLessThanOrEqual(6_000);
    expect(Buffer.byteLength(json.content, "utf8")).toBeLessThanOrEqual(6_000);
    expect(() => JSON.parse(json.content)).not.toThrow();
  });

  it("preserves the hard render budget when a recall stage rebuilds the packet", () => {
    const original = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      maxRenderedTokens: 6_000,
    });
    const rebuilt = rebuildMemoryPacket(original, {
      profile: null,
      preferences: [],
      references: [],
      facts: [{
        id: "fact-large",
        userId: "u-1",
        category: "project",
        content: "x".repeat(60_000),
        confidence: 1,
        importance: 1,
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
        },
        accessCount: 0,
        lifecycle: "active",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      language: createLanguageService(),
    });

    expect(rebuilt.renderBudget).toEqual({ maxTokens: 6_000 });
    const rendered = renderMemoryPacket(rebuilt, "developer_prompt_fragment");
    expect(Buffer.byteLength(rendered.content, "utf8")).toBeLessThanOrEqual(6_000);
  });

  it("keeps per-call maxTokens in token units when a packet also has a hard cap", () => {
    const packet = buildMemoryPacket({
      profile: {
        userId: "u-1",
        identity: {
          name: "Lin",
          role: "release quality engineer coordinating vendor approval",
        },
        expertise: { primarySkills: [], domains: [] },
        activeContext: {
          goals: [],
          currentProjects: ["release quality program"],
        },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      maxRenderedTokens: 6_000,
    });

    const rendered = renderMemoryPacket(
      packet,
      "developer_prompt_fragment",
      96,
    );
    expect(Buffer.byteLength(rendered.content, "utf8")).toBeGreaterThan(96);
    expect(Buffer.byteLength(rendered.content, "utf8")).toBeLessThanOrEqual(384);
    expect(rendered.content).toContain("release quality program");
  });

  it("renders different non-json output modes differently", () => {
    const packet = buildMemoryPacket({
      profile: {
        userId: "u-1",
        identity: { name: "Lin", role: "Robotics engineer" },
        expertise: { primarySkills: [], domains: [] },
        activeContext: { goals: [], currentProjects: ["Migration rollout"] },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
    });

    const markdown = renderMemoryPacket(packet, "markdown");
    const systemPrompt = renderMemoryPacket(packet, "system_prompt_fragment");
    const developerPrompt = renderMemoryPacket(packet, "developer_prompt_fragment");

    expect(markdown.content).toContain("## Profile");
    expect(markdown.content).toContain("## Active Context");
    expect(markdown.content).toContain("Current projects: Migration rollout");
    expect(systemPrompt.content).not.toBe(markdown.content);
    expect(developerPrompt.content).not.toBe(markdown.content);
    expect(systemPrompt.content).toContain("User memory context");
    expect(developerPrompt.content).toContain("Developer memory notes");
  });

  it("renders prompt wrappers and omission labels through the active pack", () => {
    const base = {
      profile: {
        userId: "u-localized",
        identity: { name: "林", role: "工程師" },
        expertise: { primarySkills: [], domains: [] },
        activeContext: { goals: [], currentProjects: ["移行"] },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
    };
    const traditional = renderMemoryPacket(
      buildMemoryPacket({ ...base, locale: "zh-TW" }),
      "developer_prompt_fragment",
    );
    const japanese = renderMemoryPacket(
      buildMemoryPacket({ ...base, locale: "ja-JP" }),
      "system_prompt_fragment",
    );

    expect(traditional.content).toStartWith("開發者記憶備註：");
    expect(traditional.content).not.toContain("Developer memory notes");
    expect(japanese.content).toStartWith("ユーザーメモリコンテキスト:");
    expect(japanese.content).not.toContain("User memory context");
  });

  it("respects token budgeting for json output by omitting low-priority sections", () => {
    const packet = buildMemoryPacket({
      profile: {
        userId: "u-1",
        identity: { name: "Lin", role: "Robotics engineer" },
        expertise: { primarySkills: [], domains: [] },
        activeContext: { goals: [], currentProjects: [] },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [
        {
          id: "pref-1",
          userId: "u-1",
          category: "response_style",
          value: "bullets",
          confidence: 1,
          evidenceCount: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: {
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "Finish the memory layer",
        openLoops: ["tighten recall precision"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      journal: {
        sessionId: "s-1",
        userId: "u-1",
        worklog: ["Implemented recall engine."],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const json = renderMemoryPacket(packet, "json", 20);
    const parsed = JSON.parse(json.content) as Record<string, unknown>;

    expect(json.omittedSections.length).toBeGreaterThan(0);
    expect(parsed.profileSummary).toBeDefined();
    expect(parsed.workingMemorySummary).toBeUndefined();
  });

  it("prioritizes semantic facts ahead of stylistic preferences under markdown token pressure", () => {
    const packet = buildMemoryPacket({
      profile: {
        userId: "u-1",
        identity: { name: "Adrian", role: "Staff platform engineer" },
        expertise: { primarySkills: [], domains: [] },
        activeContext: { goals: [], currentProjects: ["Release quality program"] },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [
        {
          id: "pref-1",
          userId: "u-1",
          category: "response_style",
          value: "concise bullet points and incremental delivery",
          confidence: 1,
          evidenceCount: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      references: [
        {
          id: "ref-1",
          userId: "u-1",
          title: "release-quality-program-runbook-v2.md",
          pointer: "docs/release-quality-program-runbook-v2.md",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          lifecycle: "active",
          updatedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      facts: [
        {
          id: "fact-1",
          userId: "u-1",
          category: "project",
          content: "my current role is staff platform engineer leading release quality program.",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
        },
      ],
      feedback: [
        {
          id: "fb-1",
          userId: "u-1",
          rule: "Keep answers concise.",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "general_response",
        },
      ],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
    });

    const markdown = renderMemoryPacket(packet, "markdown", 80);

    expect(markdown.content).toContain("## Facts");
    expect(markdown.content).toContain(
      "my current role is staff platform engineer leading release quality program.",
    );
  });

  it("suppresses evidence entries that duplicate facts only when the opt-in flag is set", () => {
    const packet = {
      evidenceSummary:
        "- Nissan Leaf is the user's car\n- diving trip source quote",
      factSummary:
        "- Nissan Leaf is the user's car\n- User is allergic to shellfish",
    };

    // Default (benchmark path): the duplicate line renders under both sections.
    const withoutFlag = renderMemoryPacket(
      packet,
      "developer_prompt_fragment",
      undefined,
      "coding_agent",
    );
    expect(
      withoutFlag.content.match(/Nissan Leaf is the user's car/g)?.length,
    ).toBe(2);

    // Opt-in (host injection): the evidence duplicate is dropped; unique
    // evidence and all facts remain.
    const withFlag = renderMemoryPacket(
      packet,
      "developer_prompt_fragment",
      undefined,
      "coding_agent",
      { suppressDuplicateEvidence: true },
    );
    expect(
      withFlag.content.match(/Nissan Leaf is the user's car/g)?.length,
    ).toBe(1);
    expect(withFlag.content).toContain("diving trip source quote");
    expect(withFlag.content).toContain("User is allergic to shellfish");
  });

  it("keeps working memory ahead of evidence under tight markdown token budgets", () => {
    const markdown = renderMemoryPacket(
      {
        evidenceSummary:
          "- vendor approval excerpt proves the handoff was discussed in a prior session",
        workingMemorySummary: "Current goal: finish the rollout handoff",
        journalSummary: "Current state: drafting the user reply",
      },
      "markdown",
      20,
    );

    expect(markdown.content).toContain("## Working Memory");
    expect(markdown.content).not.toContain("## Evidence");
  });

  it("keeps steering-only typed behavioral policies out of visible feedback summaries", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [
        {
          id: "fb-typed-1",
          userId: "u-1",
          rule: "Always start the response with \"Subject: [Internal]\".",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "confirmed", extractedAt: "2026-04-30T00:00:00.000Z" },
          updatedAt: "2026-04-30T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "general_response",
          attributes: attachBehavioralPolicyAttributes(undefined, {
            behavioralKind: "format_contract",
            enactmentSurface: "text_response",
            applicability: {
              appliesTo: "general_response",
              exactFragments: {
                prefixes: ["Subject: [Internal]"],
              },
            },
            transferMode: "general",
          }),
        },
      ],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
    });

    const developerPrompt = renderMemoryPacket(packet, "developer_prompt_fragment");

    expect(developerPrompt.content).toContain("Developer memory notes");
    expect(developerPrompt.content).not.toContain("Subject: [Internal]");
  });

  it("prioritizes procedural, runtime, and evidence sections for coding-agent packets under token pressure", () => {
    const packet = buildMemoryPacket({
      profile: {
        userId: "u-1",
        identity: { name: "Lin", role: "Staff engineer" },
        expertise: { primarySkills: [], domains: [] },
        activeContext: { goals: [], currentProjects: ["Phase 32 external host line"] },
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      preferences: [
        {
          id: "pref-1",
          userId: "u-1",
          category: "response_style",
          value: "concise bullets",
          confidence: 1,
          evidenceCount: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      references: [
        {
          id: "ref-1",
          userId: "u-1",
          title: "phase-32-playbook.md",
          pointer: "docs/phase-32-playbook.md",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          lifecycle: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      facts: [
        {
          id: "fact-1",
          userId: "u-1",
          category: "project",
          content: "The current blocker is packaging the external host adoption proof.",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          factKind: "blocker",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      feedback: [
        {
          id: "fb-1",
          userId: "u-1",
          rule: "Use bullets.",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "coding_agent",
        },
      ],
      archives: [],
      evidence: [
        {
          id: "evidence-1",
          userId: "u-1",
          kind: "correction_context",
          excerpt: "The user corrected the draft and required bullets.",
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          sourceMessageIds: [],
          linkedMemoryIds: ["fb-1"],
          linkedArchiveIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      episodes: [],
      workingMemory: {
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "Finish phase 32 recall",
        openLoops: ["lock eval slice"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      journal: {
        sessionId: "s-1",
        userId: "u-1",
        currentState: "Closeout draft in review.",
        worklog: ["Bootstrap contract confirmed."],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      routingDecision: planRecall({
        retrievalProfile: "coding_agent",
        query: "Continue the phase 32 coding task from last time.",
        runtime: {
          hasWorkingMemory: true,
          hasJournal: true,
        },
      }),
    });

    const markdown = renderMemoryPacket(packet, "markdown", 88);

    expect(markdown.content).toContain("## Procedural Memory");
    expect(markdown.content).toContain("## Working Memory");
    expect(markdown.content).toContain("## Session Journal");
    expect(markdown.content).toContain("## Evidence");
    expect(markdown.content.indexOf("## Procedural Memory")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Working Memory")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Session Journal")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Evidence")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
  });

  it("preserves coding-agent section order after packet serialization", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [
        {
          id: "fact-1",
          userId: "u-1",
          category: "project",
          content: "The current blocker is packaging the external host adoption proof.",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          factKind: "blocker",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      feedback: [
        {
          id: "fb-1",
          userId: "u-1",
          rule: "Use bullets.",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "coding_agent",
        },
      ],
      archives: [],
      evidence: [
        {
          id: "evidence-1",
          userId: "u-1",
          kind: "correction_context",
          excerpt: "The user corrected the draft and required bullets.",
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          sourceMessageIds: [],
          linkedMemoryIds: ["fb-1"],
          linkedArchiveIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      episodes: [],
      workingMemory: {
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "Finish phase 32 recall",
        openLoops: ["lock eval slice"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      journal: {
        sessionId: "s-1",
        userId: "u-1",
        currentState: "Closeout draft in review.",
        worklog: ["Bootstrap contract confirmed."],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      routingDecision: planRecall({
        retrievalProfile: "coding_agent",
        query: "Continue the phase 32 coding task from last time.",
        runtime: {
          hasWorkingMemory: true,
          hasJournal: true,
        },
      }),
    });

    const serializedPacket = JSON.parse(JSON.stringify(packet)) as typeof packet;
    const markdown = renderMemoryPacket(serializedPacket, "markdown", 88);

    expect(markdown.content.indexOf("## Procedural Memory")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Working Memory")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Session Journal")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
    expect(markdown.content.indexOf("## Evidence")).toBeLessThan(
      markdown.content.indexOf("## Facts"),
    );
  });

  it("dedupes duplicate feedback rules and keeps the highest-priority variant in rendered context", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [
        {
          id: "fb-coding",
          userId: "u-1",
          rule: "Use bullet points.",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-02T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "coding_agent",
        },
        {
          id: "fb-general",
          userId: "u-1",
          rule: "Use bullet points.",
          kind: "validated_pattern",
          confidence: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          updatedAt: "2026-01-01T00:00:00.000Z",
          lifecycle: "active",
          evidence: [],
          appliesTo: "general_response",
        },
      ],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      routingDecision: planRecall({
        retrievalProfile: "coding_agent",
        query: "Continue the coding task.",
        runtime: {
          hasWorkingMemory: false,
          hasJournal: false,
        },
      }),
    });

    const markdown = renderMemoryPacket(packet, "markdown");

    expect(markdown.content).toContain("Use bullet points.");
    expect(markdown.content.match(/- Use bullet points\./g)?.length ?? 0).toBe(1);
    expect(markdown.content).not.toContain("appliesTo:");
  });

  it("frames blocker facts as immediate next-step support and open loops as deferred context", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [
        {
          id: "fact-blocker",
          userId: "u-1",
          category: "project",
          content: "The current blocker is vendor approval for release quality.",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          factKind: "blocker",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "fact-open-loop",
          userId: "u-1",
          category: "project",
          content: "The open loop is final verification for release quality.",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
          factKind: "open_loop",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      routingDecision: planRecall({
        retrievalProfile: "general_chat",
        query:
          "Which runbook is the source of truth, and what should I do next for release quality?",
        runtime: {
          hasWorkingMemory: false,
          hasJournal: false,
        },
      }),
    });

    const markdown = renderMemoryPacket(packet, "markdown");

    expect(markdown.content).toContain("Immediate next-step support:");
    expect(markdown.content).toContain(
      "The current blocker is vendor approval for release quality.",
    );
    expect(markdown.content).toContain("Deferred follow-up context:");
    expect(markdown.content).toContain(
      "The open loop is final verification for release quality.",
    );
    expect(markdown.content.indexOf("Immediate next-step support:")).toBeLessThan(
      markdown.content.indexOf("Deferred follow-up context:"),
    );
  });

  it("localizes next-step support labels for Chinese memory context", () => {
    const packet = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [
        {
          id: "fact-blocker-zh",
          userId: "u-zh",
          category: "project",
          content: "当前阻塞是供应商审批。",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
          factKind: "blocker",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "fact-open-loop-zh",
          userId: "u-zh",
          category: "project",
          content: "待后续跟进的是最终签收。",
          confidence: 1,
          importance: 1,
          source: { method: "explicit", extractedAt: "2026-01-02T00:00:00.000Z" },
          factKind: "open_loop",
          scopeKind: "project",
          accessCount: 0,
          lifecycle: "active",
          isActive: true,
          supersededBy: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      locale: "zh-CN",
      routingDecision: planRecall({
        retrievalProfile: "general_chat",
        query: "当前以哪个 runbook 为准，下一步该做什么？",
        locale: "zh-CN",
        runtime: {
          hasWorkingMemory: false,
          hasJournal: false,
        },
      }),
    });

    const markdown = renderMemoryPacket(packet, "markdown");

    expect(markdown.content).toContain("当前可立即推进的下一步:");
    expect(markdown.content).toContain("后续待跟进事项:");
    expect(markdown.content).not.toContain("Immediate next-step support:");
  });

  it("renders Traditional Chinese and Japanese human-readable packet labels", () => {
    const traditional = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [{
        id: "fact-hant",
        userId: "u-hant",
        category: "project",
        content: "目前的阻礙是供應商審批。",
        confidence: 1,
        importance: 1,
        source: {
          method: "explicit",
          extractedAt: "2026-01-01T00:00:00.000Z",
          locale: "zh-TW",
        },
        factKind: "blocker",
        scopeKind: "project",
        accessCount: 0,
        lifecycle: "active",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: null,
      journal: null,
      locale: "zh-TW",
    });
    const traditionalMarkdown = renderMemoryPacket(traditional, "markdown");
    expect(traditionalMarkdown.content).toContain("## 事實");
    expect(traditionalMarkdown.content).toContain("目前的阻礙是供應商審批。");

    const japanese = buildMemoryPacket({
      profile: null,
      preferences: [],
      references: [],
      facts: [],
      feedback: [],
      archives: [],
      evidence: [],
      episodes: [],
      workingMemory: {
        sessionId: "s-ja",
        userId: "u-ja",
        currentGoal: "移行を完了する",
        openLoops: ["最終確認"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      journal: {
        sessionId: "s-ja",
        userId: "u-ja",
        currentState: "レビュー中",
        worklog: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      locale: "ja-JP",
    });
    const japaneseMarkdown = renderMemoryPacket(japanese, "markdown");
    expect(japaneseMarkdown.content).toContain("## 作業メモリ");
    expect(japaneseMarkdown.content).toContain("現在の目標: 移行を完了する");
    expect(japaneseMarkdown.content).toContain("## セッションジャーナル");
    const japaneseJson = JSON.parse(
      renderMemoryPacket(japanese, "json").content,
    ) as Record<string, unknown>;
    expect(japaneseJson.locale).toBe("ja-JP");
    expect(japaneseJson.languagePackId).toBe("ja");
    expect(japaneseJson.renderLabels).toBeUndefined();
  });
});
