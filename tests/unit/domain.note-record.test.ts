import { describe, expect, it } from "bun:test";
import {
  createNoteMemory,
  isNoteBodyWithinLimit,
  NOTE_MAX_BYTES,
  noteBodyByteLength,
} from "../../src/domain/records";
import * as root from "../../src";

const SOURCE = { method: "explicit", extractedAt: "2026-09-01T00:00:00.000Z" } as const;

describe("note memory records", () => {
  it("creates a verbatim prose note with governed defaults", () => {
    const body = "# Reading MediaWiki\n\nUse action=query with prop=extracts.\n";
    const note = createNoteMemory({
      id: "note-1",
      userId: "u-1",
      title: "Reading MediaWiki sites as an agent",
      body,
      source: SOURCE,
    });

    expect(note.body).toBe(body);
    expect(note.format).toBe("markdown");
    expect(note.lifecycle).toBe("active");
    expect(note.supersededBy).toBeNull();
    expect(note.confidence).toBe(1);
    expect(note.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(note.updatedAt).toBe("2026-09-01T00:00:00.000Z");
    expect("accessCount" in note).toBe(false);
  });

  it("keeps explicit timestamps, tags, and lifecycle when provided", () => {
    const note = createNoteMemory({
      id: "note-2",
      userId: "u-1",
      title: "Old note",
      body: "superseded body",
      format: "plain",
      source: SOURCE,
      lifecycle: "superseded",
      supersededBy: "note-3",
      tags: ["wiki"],
      observedAt: "2026-08-30T00:00:00.000Z",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(note).toMatchObject({
      format: "plain",
      lifecycle: "superseded",
      supersededBy: "note-3",
      tags: ["wiki"],
      observedAt: "2026-08-30T00:00:00.000Z",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
  });

  it("bounds note bodies at 8,192 UTF-8 bytes, not characters", () => {
    expect(NOTE_MAX_BYTES).toBe(8192);
    expect(noteBodyByteLength("abc")).toBe(3);
    expect(noteBodyByteLength("日本")).toBe(6);
    expect(noteBodyByteLength("🌸")).toBe(4);
    expect(isNoteBodyWithinLimit("x".repeat(8192))).toBe(true);
    expect(isNoteBodyWithinLimit("x".repeat(8193))).toBe(false);
    expect(isNoteBodyWithinLimit("日".repeat(2731))).toBe(false);
  });

  it("is exported from the package root", () => {
    expect(typeof root.createNoteMemory).toBe("function");
    expect(root.NOTE_MAX_BYTES).toBe(8192);
    expect(root.MEMORY_KIND_TO_PLANE.note).toBe("semantic");
  });
});
