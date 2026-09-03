import { describe, expect, it } from "bun:test";
import type { MemoryCandidate } from "../../src/remember/candidates";
import {
  classifyCandidate,
  toRememberEventMemoryType,
} from "../../src/remember/classification";

function noteCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "annotation-0",
    kindHint: "note",
    explicitness: "explicit",
    sourceMessageIndex: 0,
    sourceRole: "assistant",
    content: "# Reading MediaWiki\n\nUse action=query with prop=extracts.\n",
    metadata: { noteTitle: "Reading MediaWiki sites as an agent" },
    ...overrides,
  };
}

describe("note candidate classification", () => {
  it("admits an explicit note candidate as a note write", () => {
    const classified = classifyCandidate(noteCandidate());

    expect(classified.decision).toBe("write");
    expect(classified.memoryType).toBe("note");
    expect(classified.score).toBeGreaterThanOrEqual(0.7);
  });

  it("writes a note whose title will be derived later", () => {
    const classified = classifyCandidate(noteCandidate({ metadata: {} }));

    expect(classified.decision).toBe("write");
    expect(classified.memoryType).toBe("note");
  });

  it("rejects an oversize body before any other payload check, even when forced", () => {
    const classified = classifyCandidate(
      noteCandidate({
        content: "x".repeat(8193),
        annotation: { remember: "always", confirmed: true, kindHint: "note" },
      }),
    );

    expect(classified.decision).toBe("reject");
    expect(classified.reason).toBe("note_too_large");
  });

  it("rejects an empty body as an invalid payload", () => {
    const classified = classifyCandidate(noteCandidate({ content: "   " }));

    expect(classified.decision).toBe("reject");
    expect(classified.reason).toBe("invalid_payload");
  });

  it("maps the note memory type onto remember events", () => {
    expect(toRememberEventMemoryType("note")).toBe("note");
  });
});
