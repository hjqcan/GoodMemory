import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  assertFlatSummaryControlComparable,
  assertFrozenPrehistoryUnchanged,
  auditFrozenPrehistoryLeakage,
  loadFrozenPrehistory,
  parseFrozenPrehistorySeedReceipt,
  persistFrozenPrehistorySeedReceipt,
  sealFrozenPrehistory,
} from "../../scripts/codex-coding-effect/frozen-prehistory";

const SHA256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

describe("Codex coding-effect C3 frozen prehistory", () => {
  it("requires explicit opt-in for exact zero-byte history", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-empty-history-"));
    const path = join(root, "empty.jsonl");
    try {
      await writeFile(path, "", "utf8");
      await expect(loadFrozenPrehistory({
        expectedSha256: SHA256(""),
        path,
      })).rejects.toThrow(
        "frozen prehistory must contain at least one record",
      );

      const artifact = await loadFrozenPrehistory({
        allowEmpty: true,
        expectedSha256: SHA256(""),
        path,
      });

      expect(artifact.sourceBytes).toBe("");
      expect(artifact.sourceSha256).toBe(SHA256(""));
      expect(artifact.records).toEqual([]);
      expect(Object.isFrozen(artifact.records)).toBe(true);

      for (const nonCanonicalEmpty of ["\n", " \t"]) {
        await writeFile(path, nonCanonicalEmpty, "utf8");
        await expect(loadFrozenPrehistory({
          allowEmpty: true,
          expectedSha256: SHA256(nonCanonicalEmpty),
          path,
        })).rejects.toThrow(
          "canonical empty frozen prehistory must be exactly zero bytes",
        );
      }

      await writeFile(path, "", "utf8");
      await expect(sealFrozenPrehistory({
        artifact,
        sealedPath: join(root, "sealed-default.jsonl"),
      })).rejects.toThrow(
        "frozen prehistory must contain at least one record",
      );
      const sealed = await sealFrozenPrehistory({
        allowEmpty: true,
        artifact,
        sealedPath: join(root, "sealed-opt-in.jsonl"),
      });
      expect(sealed.records).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads strict JSONL, binds the source bytes, and freezes parsed records", async () => {
    await withPrehistory(async ({ path, raw }) => {
      const artifact = await loadFrozenPrehistory({
        expectedSha256: SHA256(raw),
        path,
      });

      expect(artifact.sourceSha256).toBe(SHA256(raw));
      expect(artifact.records).toEqual([
        {
          id: "line-1",
          message: "Remember the c3 transport normalization convention.",
          role: "user",
        },
        {
          id: "line-2",
          message: "The public error wording is a compatibility boundary.",
          role: "assistant",
        },
      ]);
      expect(Object.isFrozen(artifact)).toBe(true);
      expect(Object.isFrozen(artifact.records)).toBe(true);
      expect(Object.isFrozen(artifact.records[0])).toBe(true);
    });
  });

  it("rejects hash drift, non-native fields, and malformed rollout lines", async () => {
    await withPrehistory(async ({ path, raw }) => {
      await expect(loadFrozenPrehistory({
        expectedSha256: "0".repeat(64),
        path,
      })).rejects.toThrow("frozen prehistory hash does not match");

      const unknownRaw = `${raw.trimEnd().replace(
        '"type":"response_item"}',
        '"gold":"leak","type":"response_item"}',
      )}\n`;
      await writeFile(path, unknownRaw, "utf8");
      await expect(loadFrozenPrehistory({
        expectedSha256: SHA256(unknownRaw),
        path,
      })).rejects.toThrow("line 1");

      const malformedRaw = '{"payload":{"type":"message"}\n';
      await writeFile(path, malformedRaw, "utf8");
      await expect(loadFrozenPrehistory({
        expectedSha256: SHA256(malformedRaw),
        path,
      })).rejects.toThrow("line 1 is not valid JSON");
    });
  });

  it("blocks literal, normalized, and evaluator-artifact leakage before execution", async () => {
    await withPrehistory(async ({ path }) => {
      const goldPatch = [
        "diff --git a/src/mode.ts b/src/mode.ts",
        "@@ -1 +1 @@",
        "-const normalized = value.toLowerCase();",
        "+const normalized = value.trim().toLowerCase();",
        "",
      ].join("\n");
      const hiddenTest = 'expect(parseTransportMode(" safe ")).toBe("safe");\n';
      const raw = [
        rolloutLine("user", "Never reveal HIDDEN   SENTINEL to Codex."),
        rolloutLine("assistant", "Use const normalized = value.trim().toLowerCase(); in this task."),
        "",
      ].join("\n");
      await writeFile(path, raw, "utf8");
      const artifact = await loadFrozenPrehistory({
        expectedSha256: SHA256(raw),
        path,
      });

      const audit = auditFrozenPrehistoryLeakage({
        artifact,
        declaredForbiddenSourceSha256: [
          SHA256(goldPatch),
          SHA256(hiddenTest),
        ],
        forbiddenSources: [
          { content: goldPatch, label: "gold patch" },
          { content: hiddenTest, label: "hidden test" },
        ],
        forbiddenStrings: ["hidden sentinel"],
      });

      expect(audit.passed).toBe(false);
      expect(audit.overlaps.map((overlap) => overlap.kind)).toContain(
        "forbidden-string-normalized",
      );
      expect(audit.overlaps.some((overlap) =>
        overlap.kind === "source-line-normalized" &&
        overlap.sourceLabel === "gold patch"
      )).toBe(true);
    });
  });

  it("requires every evaluator leakage source hash to be declared", async () => {
    await withPrehistory(async ({ path, raw }) => {
      const artifact = await loadFrozenPrehistory({
        expectedSha256: SHA256(raw),
        path,
      });
      const hiddenTest = "assert hidden behavior\n";

      expect(() => auditFrozenPrehistoryLeakage({
        artifact,
        declaredForbiddenSourceSha256: [],
        forbiddenSources: [{ content: hiddenTest, label: "hidden test" }],
        forbiddenStrings: [],
      })).toThrow("undeclared forbidden source hash");
    });
  });

  it("detects source edits after run identity instead of seeding changed history", async () => {
    await withPrehistory(async ({ path, raw }) => {
      const artifact = await loadFrozenPrehistory({
        expectedSha256: SHA256(raw),
        path,
      });
      await writeFile(path, `${raw} `, "utf8");

      await expect(assertFrozenPrehistoryUnchanged(artifact)).rejects.toThrow(
        "changed after run identity",
      );
    });
  });

  it("seals an evaluator-owned rollout copy and never seeds from the mutable dataset path", async () => {
    await withPrehistory(async ({ path, raw }) => {
      const artifact = await loadFrozenPrehistory({
        expectedSha256: SHA256(raw),
        path,
      });
      const sealedPath = join(
        dirname(path),
        "sealed",
        "rollout-2026-07-15T00-00-00-11111111-1111-1111-1111-111111111111.jsonl",
      );
      const sealed = await sealFrozenPrehistory({ artifact, sealedPath });

      expect(sealed.path).toBe(sealedPath);
      expect(sealed.sourceSha256).toBe(artifact.sourceSha256);
      expect(await readFile(sealedPath, "utf8")).toBe(raw);
      expect((await stat(sealedPath)).mode & 0o222).toBe(0);

      await writeFile(path, "dataset source changed after sealing\n", "utf8");
      await expect(assertFrozenPrehistoryUnchanged(sealed)).resolves.toBeUndefined();

      await chmod(sealedPath, 0o600);
      await writeFile(sealedPath, `${raw} `, "utf8");
      await expect(assertFrozenPrehistoryUnchanged(sealed)).rejects.toThrow(
        "changed after run identity",
      );
    });
  });

  it("persists a strict seed receipt for packaged rollout writeback", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-seed-receipt-"));
    try {
      const path = join(root, "seed-receipt.json");
      const receipt = {
        historySourceSha256: "a".repeat(64),
        memoryExportSha256: "b".repeat(64),
        rawTranscriptPersisted: false as const,
        schemaVersion: 1 as const,
        seedSurface: "codex-writeback-from-rollout" as const,
        sourceSessionDigest: "session:prehistory",
        writebackOutcome: "written" as const,
        writtenMemoryIds: ["memory-001"],
      };

      await persistFrozenPrehistorySeedReceipt(path, receipt);
      expect(parseFrozenPrehistorySeedReceipt(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      )).toEqual(receipt);
      await expect(persistFrozenPrehistorySeedReceipt(path, receipt))
        .rejects.toThrow();
      expect(() => parseFrozenPrehistorySeedReceipt({
        ...receipt,
        seedSurface: "remember",
      })).toThrow("invalid frozen-prehistory seed receipt");
      expect(() => parseFrozenPrehistorySeedReceipt({
        ...receipt,
        writtenMemoryIds: [],
      })).toThrow("invalid frozen-prehistory seed receipt");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("pins flat-summary to the same history and exact injection budget", () => {
    const sourceSha256 = "a".repeat(64);
    expect(() => assertFlatSummaryControlComparable({
      goodMemory: { historySourceSha256: sourceSha256, maxInjectedTokens: 512 },
      summary: { historySourceSha256: sourceSha256, maxInjectedTokens: 512 },
    })).not.toThrow();
    expect(() => assertFlatSummaryControlComparable({
      goodMemory: { historySourceSha256: sourceSha256, maxInjectedTokens: 512 },
      summary: { historySourceSha256: "b".repeat(64), maxInjectedTokens: 512 },
    })).toThrow("history source hash");
    expect(() => assertFlatSummaryControlComparable({
      goodMemory: { historySourceSha256: sourceSha256, maxInjectedTokens: 512 },
      summary: { historySourceSha256: sourceSha256, maxInjectedTokens: 511 },
    })).toThrow("token budget");
  });
});

async function withPrehistory(
  run: (fixture: { path: string; raw: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-prehistory-"));
  const path = join(root, "prehistory.jsonl");
  const raw = [
    rolloutLine("user", "Remember the c3 transport normalization convention."),
    rolloutLine("assistant", "The public error wording is a compatibility boundary."),
    "",
  ].join("\n");
  try {
    await writeFile(path, raw, "utf8");
    await run({ path, raw });
    await readFile(path, "utf8");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function rolloutLine(
  role: "assistant" | "user",
  text: string,
): string {
  return JSON.stringify({
    payload: {
      content: [{
        text,
        type: role === "user" ? "input_text" : "output_text",
      }],
      role,
      type: "message",
    },
    type: "response_item",
  });
}
