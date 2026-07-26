import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertC6SourcePoolArtifact,
  buildC6SWEbenchMultilingualSourcePoolSnapshot,
  C6_SWE_BENCH_MULTILINGUAL_SOURCE,
  serializeC6SourcePoolSnapshot,
} from "../../scripts/codex-coding-effect/c6-source-pool";
import {
  parseC6SourcePoolSnapshotCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-source-pool";

describe("Codex coding-effect C6 source-pool snapshot", () => {
  it("commits every real source row without promoting one to an episode", () => {
    const rows = buildRows();
    const snapshot = buildC6SWEbenchMultilingualSourcePoolSnapshot(rows);

    expect(snapshot).toMatchObject({
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        status: "source-pool-only-origin-and-relationship-review-required",
      },
      counts: {
        observedRows: 300,
        queuedForOriginAndRelationshipReview: 274,
        rejectedBeforeOriginReview: 26,
        repositories: 41,
      },
      schemaVersion: 1,
      source: C6_SWE_BENCH_MULTILINGUAL_SOURCE,
    });
    expect(snapshot.rows).toHaveLength(300);
    expect(snapshot.rows[0]).toMatchObject({
      decision: "queued-for-origin-and-relationship-review",
      instanceId: "owner0__repository0-1000",
      rejectionReasons: [],
      rowIndex: 0,
    });
    expect(snapshot.rows[274]).toMatchObject({
      decision: "rejected-before-origin-review",
      rejectionReasons: ["missing-pass-to-pass"],
    });
    expect(snapshot.rows[299]).toMatchObject({
      decision: "rejected-before-origin-review",
      rejectionReasons: ["missing-fail-to-pass"],
    });

    const serialized = serializeC6SourcePoolSnapshot(snapshot);
    expect(serialized).not.toContain("agent-visible-sentinel");
    expect(serialized).not.toContain("gold-patch-sentinel");
    expect(serialized).not.toContain("test-patch-sentinel");
    expect(serialized).toEndWith("\n");
  });

  it("is deterministic and rejects duplicate upstream identities", () => {
    const rows = buildRows();
    const first = serializeC6SourcePoolSnapshot(
      buildC6SWEbenchMultilingualSourcePoolSnapshot(rows),
    );
    const second = serializeC6SourcePoolSnapshot(
      buildC6SWEbenchMultilingualSourcePoolSnapshot(
        structuredClone(rows),
      ),
    );
    expect(second).toBe(first);

    rows[1] = {
      ...rows[1],
      instance_id: rows[0]!.instance_id,
    };
    expect(() =>
      buildC6SWEbenchMultilingualSourcePoolSnapshot(rows)
    ).toThrow("duplicate instance_id");
  });

  it("fails closed on artifact byte or size drift", () => {
    const bytes = Buffer.from("pinned artifact\n");
    const pin = {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
    expect(() =>
      assertC6SourcePoolArtifact(bytes, pin, "fixture")
    ).not.toThrow();
    expect(() =>
      assertC6SourcePoolArtifact(
        Buffer.from("binned artifact\n"),
        pin,
        "fixture",
      )
    ).toThrow("fixture does not match its frozen bytes");
    expect(() =>
      assertC6SourcePoolArtifact(bytes, {
        ...pin,
        bytes: pin.bytes + 1,
      }, "fixture")
    ).toThrow("fixture does not match its frozen byte length");
  });

  it("parses only explicit local pinned-source inputs", () => {
    expect(parseC6SourcePoolSnapshotCliOptions([
      "--parquet-file=/evidence/source.parquet",
      "--readme-file=/evidence/README.md",
      "--output=/evidence/source-pool.json",
    ])).toEqual({
      output: "/evidence/source-pool.json",
      parquetFile: "/evidence/source.parquet",
      readmeFile: "/evidence/README.md",
    });

    expect(() =>
      parseC6SourcePoolSnapshotCliOptions([
        "--parquet-file=/evidence/source.parquet",
        "--readme-file=/evidence/README.md",
      ])
    ).toThrow("--output is required exactly once");
    expect(() =>
      parseC6SourcePoolSnapshotCliOptions([
        "--parquet-file=/evidence/one.parquet",
        "--parquet-file=/evidence/two.parquet",
        "--readme-file=/evidence/README.md",
        "--output=/evidence/source-pool.json",
      ])
    ).toThrow("--parquet-file cannot be specified more than once");
  });

  it("tracks a real source commitment without overstating raw-row or project-license evidence", () => {
    const serialized = readFileSync(
      join(
        import.meta.dir,
        "../../fixtures/codex-coding-effect/c6-source-pool/swe-bench-multilingual-e5c585e.source-pool.json",
      ),
      "utf8",
    );
    const artifact = JSON.parse(serialized) as {
      boundary: {
        acceptedEpisodeCount: number;
        candidateManifestFrozen: boolean;
        status: string;
      };
      counts: {
        observedRows: number;
        queuedForOriginAndRelationshipReview: number;
        rejectedBeforeOriginReview: number;
        repositories: number;
      };
      rows: Array<Record<string, unknown>>;
      source: Record<string, unknown>;
    };

    expect(Buffer.byteLength(serialized)).toBe(333_573);
    expect(sha256(serialized)).toBe(
      "15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5",
    );
    expect(artifact.source.datasetCardLicense).toBe("MIT");
    expect(artifact.source).not.toHaveProperty("license");
    expect(artifact.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      status: "source-pool-only-origin-and-relationship-review-required",
    });
    expect(artifact.counts).toEqual({
      observedRows: 300,
      queuedForOriginAndRelationshipReview: 274,
      rejectedBeforeOriginReview: 26,
      repositories: 41,
    });
    expect(artifact.rows).toHaveLength(300);
    expect(artifact.rows.every((row) =>
      typeof row.normalizedRowSha256 === "string" &&
      !Object.hasOwn(row, "rawRowSha256")
    )).toBe(true);
    expect(serialized).not.toContain("\"problem_statement\"");
    expect(serialized).not.toContain("\"test_patch\"");
    expect(serialized).not.toContain("\"FAIL_TO_PASS\"");
    expect(serialized).not.toContain("\"PASS_TO_PASS\"");
  });
});

function buildRows(): Array<Record<string, unknown>> {
  return Array.from({ length: 300 }, (_, index) => {
    const missingPassToPass = index >= 274 && index < 299;
    const missingFailToPass = index === 299;
    return {
      base_commit: sha256(`base-${index}`).slice(0, 40),
      created_at: `2024-01-${String((index % 28) + 1).padStart(2, "0")} 00:00:00`,
      FAIL_TO_PASS: missingFailToPass ? [] : [`fail-${index}`],
      hints_text: `hint-${index}`,
      instance_id:
        `owner${index % 41}__repository${index % 41}-${1000 + index}`,
      PASS_TO_PASS: missingPassToPass ? [] : [`pass-${index}`],
      patch: `gold-patch-sentinel-${index}`,
      problem_statement: `agent-visible-sentinel-${index}`,
      repo: `owner${index % 41}/repository${index % 41}`,
      test_patch: `test-patch-sentinel-${index}`,
      version: String(1000 + index),
    };
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
