import { describe, expect, it } from "bun:test";
import {
  getMemoryPlane,
  isMemoryKind,
  MEMORY_KIND_TO_PLANE,
} from "../../src/domain/taxonomy";

describe("memory taxonomy", () => {
  it("maps runtime, semantic, episodic, procedural, and derived kinds to distinct planes", () => {
    expect(getMemoryPlane("session_buffer")).toBe("runtime");
    expect(getMemoryPlane("profile")).toBe("semantic");
    expect(getMemoryPlane("note")).toBe("semantic");
    expect(isMemoryKind("note")).toBe(true);
    expect(getMemoryPlane("episode")).toBe("episodic");
    expect(getMemoryPlane("feedback")).toBe("procedural");
    expect(getMemoryPlane("insight")).toBe("derived");
  });

  it("rejects invalid kinds", () => {
    expect(isMemoryKind("profile")).toBe(true);
    expect(isMemoryKind("bogus")).toBe(false);
    expect(() => getMemoryPlane("bogus" as never)).toThrow("Unknown memory kind");
  });

  it("keeps a complete kind-to-plane mapping", () => {
    expect(Object.keys(MEMORY_KIND_TO_PLANE).length).toBeGreaterThan(5);
  });
});
