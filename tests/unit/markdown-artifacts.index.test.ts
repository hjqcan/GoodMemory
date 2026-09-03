import { describe, expect, it } from "bun:test";
import {
  createEpisodeMemory,
  createFactMemory,
  createFeedbackMemory,
  createNoteMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createUserProfile,
} from "../../src/domain/records";
import { createEvidenceRecord } from "../../src/evidence/contracts";
import { buildMarkdownArtifacts } from "../../src/governance/markdownArtifacts";
import type { MarkdownArtifactBundle } from "../../src/governance/markdownArtifacts";
import { createHostAdapter } from "../../src/host";
import { createLanguageService } from "../../src/language";
import type { ExportMemoryResult } from "../../src/api/contracts";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";

const NOW = "2026-04-02T00:00:00.000Z";
const scope = { userId: "u-1", workspaceId: "workspace-a" };
const SOURCE = { method: "explicit", extractedAt: NOW } as const;
const language = createLanguageService();
const languageContext = language.resolveFromText({ locale: "en-US", text: "" });

function fact(id: string, content: string, overrides: Record<string, unknown> = {}) {
  return createFactMemory({ ...scope, id, category: "project", content, source: SOURCE, createdAt: NOW, updatedAt: NOW, ...overrides });
}

function durable(overrides: Partial<ExportMemoryResult["durable"]> = {}): ExportMemoryResult["durable"] {
  return {
    profile: createUserProfile({
      userId: "u-1",
      identity: { name: "Lin", role: "Platform engineer" },
      expertise: { primarySkills: ["TypeScript"], domains: ["infra"], level: "senior" },
      activeContext: { goals: ["Ship v0.8"], currentProjects: ["GoodMemory"] },
    }),
    preferences: [createPreferenceMemory({ ...scope, id: "pref-1", category: "style", value: "concise", source: SOURCE, updatedAt: NOW })],
    references: [createReferenceMemory({ ...scope, id: "ref-1", title: "Runbook", pointer: "https://example.com/runbook", source: SOURCE, createdAt: NOW, updatedAt: NOW })],
    facts: [
      fact("fact-active", "Migration rollout is blocked on prod verification.", {
        tags: ["goal"],
        attributes: { horizon: "quarter" },
        occurrence: { start: "2026-04-01T16:00:00.000Z", endExclusive: "2026-04-02T16:00:00.000Z", precision: "day", timezone: "Asia/Shanghai" },
      }),
      fact("fact-old", "Migration rollout owner was Nora.", { lifecycle: "superseded", isActive: false, supersededBy: "fact-active" }),
    ],
    feedback: [createFeedbackMemory({ ...scope, id: "fb-1", rule: "Use bullet points in summaries.", kind: "validated_pattern", source: SOURCE, updatedAt: NOW })],
    episodes: [createEpisodeMemory({ ...scope, id: "ep-1", summary: "Planned the rollout verification.", keyDecisions: [], unresolvedItems: [], topics: [], entities: [], importance: 1, createdAt: NOW })],
    archives: [],
    evidence: [createEvidenceRecord({ ...scope, id: "ev-1", kind: "conversation_excerpt", excerpt: "Rollout is blocked.", source: SOURCE, linkedMemoryIds: ["fact-active"], createdAt: NOW })],
    experiences: [],
    proposals: [],
    promotions: [],
    ...overrides,
  };
}

function build(overrides: Partial<ExportMemoryResult["durable"]> = {}): MarkdownArtifactBundle {
  return buildMarkdownArtifacts({ language, languageContext, scope, durable: durable(overrides) });
}

function file(bundle: MarkdownArtifactBundle, relativePath: string): string {
  const found = bundle.files.find((entry) => entry.relativePath === relativePath);
  if (!found) {
    throw new Error(`missing ${relativePath}: ${bundle.files.map((entry) => entry.relativePath).join(", ")}`);
  }
  return found.content;
}

describe("index-only MEMORY.md and topic pages", () => {
  it("orders the compiled persona, the index, topic pages, and note/episode pages", () => {
    const bundle = build({ notes: [createNoteMemory({ ...scope, id: "note-1", title: "Reading MediaWiki", body: "# Reading MediaWiki\n\nUse api.php.", source: SOURCE, createdAt: NOW, updatedAt: NOW })] });

    expect(bundle.files.map((entry) => entry.relativePath)).toEqual([
      "user.md",
      "MEMORY.md",
      "topics/preferences.md",
      "topics/feedback.md",
      "topics/references.md",
      "topics/facts.md",
      "topics/notes.md",
      "topics/episodes/2026-04.md",
      "playbooks/use-bullet-points-in-summaries.md",
      "playbooks/use-bullet-points-in-summaries.prompt.md",
      "playbooks/use-bullet-points-in-summaries.skill.md",
    ]);
    expect(bundle.files.filter((entry) => entry.kind === "topic")).toHaveLength(6);
  });

  it("keeps MEMORY.md as a bounded index with one line per record and a files section", () => {
    const facts = Array.from({ length: 500 }, (_, index) =>
      fact(`fact-${String(index).padStart(3, "0")}`, `Synthetic durable fact number ${index} about the migration rollout and its verification.`),
    );
    const index = file(build({ facts }), "MEMORY.md");
    const lines = index.split("\n");

    expect(lines.length).toBeLessThanOrEqual(200);
    expect(Buffer.byteLength(index, "utf8")).toBeLessThanOrEqual(25_000);
    expect(index).toContain("## Files");
    expect(index).toContain("- topics/facts.md");
    expect(index).toContain("- user.md");
    expect(lines.filter((line) => line.startsWith("- [fact] ")).length).toBeGreaterThan(20);
    for (const line of lines.filter((line) => line.startsWith("- [fact] "))) {
      expect(line).toMatch(/^- \[fact\] \S+ \d{4}-\d{2}-\d{2} .+$/);
    }
    expect(lines.at(-1)).toMatch(/omitted records: \d+/i);
  });

  it("moves detail into topic pages and keeps the index free of metadata suffixes", () => {
    const bundle = build();
    const index = file(bundle, "MEMORY.md");
    const facts = file(bundle, "topics/facts.md");

    expect(index).toContain("- [fact] fact-active 2026-04-02 Migration rollout is blocked on prod verification. [evidence: 1]");
    expect(index).not.toContain("[occurrence:");
    expect(index).not.toContain("{tags:");
    expect(facts).toContain("# Facts");
    expect(facts).toContain("## Active");
    expect(facts).toContain("## Superseded");
    expect(facts).toContain("[occurrence: 2026-04-01T16:00:00.000Z..2026-04-02T16:00:00.000Z; precision=day; timezone=Asia/Shanghai]");
    expect(facts).toContain("{tags: goal; attributes: horizon=quarter}");
    expect(facts.indexOf("Migration rollout owner was Nora.")).toBeGreaterThan(facts.indexOf("## Superseded"));
    expect(file(bundle, "topics/episodes/2026-04.md")).toContain("Planned the rollout verification.");
    expect(bundle.files.some((entry) => entry.relativePath === "topics/notes.md")).toBe(false);
  });

  it("renders note pages verbatim in the notes topic", () => {
    const notes = file(
      build({ notes: [createNoteMemory({ ...scope, id: "note-1", title: "Reading MediaWiki", body: "# Reading MediaWiki\n\nUse api.php.", source: SOURCE, createdAt: NOW, updatedAt: NOW })] }),
      "topics/notes.md",
    );

    expect(notes).toContain("### Reading MediaWiki");
    expect(notes).toContain("# Reading MediaWiki\n\nUse api.php.");
  });

  it("compiles user.md into the persona sections from the layering design", () => {
    const user = file(build(), "user.md");

    for (const heading of ["## Profile", "## Expertise", "## Current Projects And Goals", "## Collaboration Preferences", "## Stable Procedural Guidance", "## Provenance"]) {
      expect(user).toContain(heading);
    }
    expect(user).toContain("TypeScript");
    expect(user).toContain("Ship v0.8");
    expect(user).toContain("style: concise");
    expect(user).toContain("Use bullet points in summaries.");
    expect(user).toContain("2026-04-02");
  });

  it("localizes every new artifact label in every built-in pack", () => {
    for (const locale of ["en-US", "zh-CN", "zh-TW", "fr-FR", "es-ES", "ja-JP", "ko-KR"]) {
      const context = language.resolveFromText({ locale, text: "" });
      for (const key of ["files", "topic_active", "topic_superseded", "topic_archived", "expertise", "current_projects_and_goals", "collaboration_preferences", "stable_procedural_guidance", "provenance_summary", "omitted_records"] as const) {
        const rendered = language.render({ key, values: { count: 3 } }, context);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).not.toBe(key);
      }
    }
  });

  it("exposes topic pages to hosts only when the topic_page artifact type is negotiated", async () => {
    const exported: ExportMemoryResult = {
      pages: buildPageArtifacts({ notes: [] }),
      artifacts: build(),
      durable: durable(),
      exportedAt: NOW,
      scope,
    };
    const memory = { exportMemory: async () => exported };

    const negotiated = createHostAdapter({ id: "topics", memory, readableArtifactTypes: ["memory_index", "topic_page"] });
    const defaults = createHostAdapter({ id: "defaults", memory });

    const withTopics = await negotiated.readArtifacts({ scope });
    const withoutTopics = await defaults.readArtifacts({ scope });
    expect(withTopics.artifacts.filter((artifact) => artifact.artifactType === "topic_page").map(({ relativePath }) => relativePath)).toEqual([
      "topics/preferences.md",
      "topics/feedback.md",
      "topics/references.md",
      "topics/facts.md",
      "topics/episodes/2026-04.md",
    ]);
    expect(withoutTopics.artifacts.some((artifact) => artifact.relativePath.startsWith("topics/"))).toBe(false);
  });
});
