import { describe, expect, it } from "bun:test";

import {
  assertStorageSafeExternalValue,
  findStorageUnsafeTextPath,
  hasPersistableSemanticText,
  hasSemanticText,
  isStorageSafeText,
} from "../../src/domain/semanticText";

describe("semantic and storage-safe text boundaries", () => {
  it("keeps semantic presence independent from storage safety", () => {
    const value = "visible\u0000text";

    expect(hasSemanticText(value)).toBe(true);
    expect(isStorageSafeText(value)).toBe(false);
    expect(isStorageSafeText("visible\uD800text")).toBe(false);
    expect(isStorageSafeText("visible\uDC00text")).toBe(false);
    expect(isStorageSafeText("visible😀text")).toBe(true);
    expect(hasPersistableSemanticText(value)).toBe(false);
  });

  it("locates unsafe strings in nested records, arrays, and keys", () => {
    expect(findStorageUnsafeTextPath({
      metadata: { tags: ["safe", "release\u0000private"] },
    }, "candidate")).toBe("candidate.metadata.tags[1]");
    expect(findStorageUnsafeTextPath({
      "unsafe\u0000key": "safe value",
    }, "candidate")).toBe('candidate["unsafe\\u0000key"]');
    expect(findStorageUnsafeTextPath({ safe: [true, 42, null] }, "candidate"))
      .toBeUndefined();
  });

  it("throws a stable typed public-argument error", () => {
    let error: unknown;
    try {
      assertStorageSafeExternalValue({ id: "message\u0000id" }, "message");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      code: "ERR_GOODMEMORY_STORAGE_UNSAFE_TEXT",
      path: "message.id",
    });
    expect(String(error)).toContain("Storage-unsafe text at message.id");
  });
});
