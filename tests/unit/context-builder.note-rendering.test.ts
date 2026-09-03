import { describe, expect, it } from "bun:test";
import { createNoteMemory } from "../../src/domain/records";
import { createLanguageService } from "../../src/language";
import {
  buildMemoryPacket,
  renderMemoryPacket,
} from "../../src/recall/contextBuilder";
import type { MemoryPacketInput } from "../../src/recall/contextBuilder";

const NOW = "2026-09-01T00:00:00.000Z";
const BODY = [
  "# Reading MediaWiki",
  "",
  "Most MediaWiki sites expose api.php.",
  "",
  "## Search",
  "Use list=search with srsearch=<terms>.",
].join("\n");

function packetInput(overrides: Partial<MemoryPacketInput> = {}): MemoryPacketInput {
  return {
    profile: null,
    preferences: [],
    references: [],
    notes: [
      createNoteMemory({
        id: "note-1",
        userId: "u-1",
        title: "Reading MediaWiki sites as an agent",
        body: BODY,
        source: { method: "explicit", extractedAt: NOW },
      }),
    ],
    facts: [{
      id: "fact-1",
      userId: "u-1",
      category: "project",
      content: "The rollout owner is Nora.",
      confidence: 1,
      importance: 1,
      source: { method: "explicit", extractedAt: NOW },
      lifecycle: "active",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    }, {
      id: "fact-2",
      userId: "u-1",
      category: "project",
      content: "The rollout is blocked by legal signoff.",
      confidence: 1,
      importance: 1,
      source: { method: "explicit", extractedAt: NOW },
      lifecycle: "active",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    feedback: [],
    archives: [],
    evidence: [],
    episodes: [],
    workingMemory: null,
    journal: null,
    ...overrides,
  };
}

describe("note rendering", () => {
  it("summarizes notes with their title and verbatim body", () => {
    const packet = buildMemoryPacket(packetInput());

    expect(packet.noteSummary).toBe(`### Reading MediaWiki sites as an agent\n${BODY}`);
  });

  it("keeps note structure in markdown and in both prompt fragments", () => {
    const packet = buildMemoryPacket(packetInput());

    const markdown = renderMemoryPacket(packet, "markdown").content;
    expect(markdown).toContain("## Notes\n### Reading MediaWiki sites as an agent\n# Reading MediaWiki\n\nMost MediaWiki");
    expect(markdown).toContain("## Facts\n- The rollout owner is Nora.\n- The rollout is blocked by legal signoff.");

    for (const output of ["system_prompt_fragment", "developer_prompt_fragment"] as const) {
      const fragment = renderMemoryPacket(packet, output).content;
      expect(fragment).toContain("Facts: - The rollout owner is Nora. - The rollout is blocked by legal signoff.");
      expect(fragment).toContain("Notes:\n### Reading MediaWiki sites as an agent\n# Reading MediaWiki\n\nMost MediaWiki");
    }
  });

  it("exposes the note section to JSON output and keeps it when durable memory is reranked", () => {
    const packet = buildMemoryPacket(packetInput({ durableCandidateOrder: ["facts:fact-2", "facts:fact-1"] }));

    const json = JSON.parse(renderMemoryPacket(packet, "json").content) as { noteSummary?: string };
    expect(json.noteSummary).toContain("### Reading MediaWiki sites as an agent");
    expect(renderMemoryPacket(packet, "markdown").content).toContain("## Notes\n");
  });

  it("omits the note section under a tight budget instead of flattening it", () => {
    const packet = buildMemoryPacket(packetInput());

    const rendered = renderMemoryPacket(packet, "markdown", 40);
    expect(rendered.omittedSections).toContain("Notes");
  });

  it("localizes the note labels in every built-in pack", () => {
    const language = createLanguageService();
    for (const locale of ["en-US", "zh-CN", "zh-TW", "fr-FR", "es-ES", "ja-JP", "ko-KR"]) {
      const context = language.resolveFromText({ locale, text: "" });
      for (const key of ["note", "note_item"] as const) {
        const rendered = language.render({ key }, context);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered).not.toBe(key);
      }
    }
  });

  it("renders no note section when no notes were recalled", () => {
    const packet = buildMemoryPacket(packetInput({ notes: [] }));

    expect(packet.noteSummary).toBeUndefined();
    expect(renderMemoryPacket(packet, "markdown").content).not.toContain("## Notes");
  });
});
