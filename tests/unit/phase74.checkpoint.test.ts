import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPhase74FileCheckpoint,
  phase74CheckpointPath,
} from "../../src/eval/phase74Checkpoint";

describe("Phase 74 file checkpoint", () => {
  it("round-trips committed retrieval, E4, and oracle units", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-checkpoint-"));
    try {
      const checkpoint = createPhase74FileCheckpoint(root);
      const snapshot = {
        evidenceLedgers: { prose: "Postgres" },
        retrievedMemories: [],
        snapshotId: "snapshot-1",
        storedMemories: [],
      };
      await checkpoint.saveRetrieval("retrieval-key", snapshot);
      await checkpoint.saveE4("e4-key", {
        answer: "Postgres",
        caseId: "case-1",
        clusterId: "conversation-1",
        contextTokens: 1,
        contextTokensBeforeTruncation: 1,
        contextTruncated: false,
        correct: true,
        format: "prose",
        renderedLedgerSha256: "a".repeat(64),
        score: 1,
        sourceSnapshotId: "snapshot-1",
      });
      await checkpoint.saveOracle("oracle-key", []);

      expect(await checkpoint.loadRetrieval("retrieval-key")).toEqual(snapshot);
      expect(await checkpoint.loadE4("e4-key")).toMatchObject({
        answer: "Postgres",
        correct: true,
      });
      expect(await checkpoint.loadOracle("oracle-key")).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects conflicting commits and payload tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-checkpoint-"));
    try {
      const checkpoint = createPhase74FileCheckpoint(root);
      await checkpoint.saveRetrieval("same-key", {
        retrievedMemories: [],
        snapshotId: "snapshot-1",
        storedMemories: [],
      });
      await expect(checkpoint.saveRetrieval("same-key", {
        retrievedMemories: [],
        snapshotId: "snapshot-2",
        storedMemories: [],
      })).rejects.toThrow("conflicting checkpoint commit");

      const path = phase74CheckpointPath(root, "retrieval", "same-key");
      const envelope = JSON.parse(await readFile(path, "utf8"));
      envelope.payload.snapshotId = "tampered";
      await writeFile(path, JSON.stringify(envelope));
      await expect(checkpoint.loadRetrieval("same-key")).rejects.toThrow(
        "checkpoint payload hash mismatch",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("syncs a complete temporary file before create-only publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-checkpoint-order-"));
    const calls: string[] = [];
    try {
      const checkpoint = createPhase74FileCheckpoint(root, {
        async link(source, destination) {
          calls.push(`link:${source.endsWith(".tmp")}:${destination.endsWith(".json")}`);
        },
        async open(path, flags) {
          const target = path === root
            ? "root"
            : path === join(root, "retrieval")
              ? "directory"
              : "temp";
          calls.push(`open:${target}:${flags}`);
          return {
            async close() {
              calls.push("close");
            },
            async sync() {
              calls.push("sync");
            },
            async writeFile() {
              calls.push("write");
            },
          };
        },
        randomId: () => "temporary",
        async unlink(path) {
          calls.push(`unlink:${path.endsWith(".tmp")}`);
        },
      });

      await checkpoint.saveRetrieval("retrieval-key", {
        retrievedMemories: [],
        snapshotId: "snapshot-1",
        storedMemories: [],
      });

      expect(calls).toEqual([
        "open:root:r",
        "sync",
        "close",
        "open:temp:wx",
        "write",
        "sync",
        "close",
        "link:true:true",
        "open:directory:r",
        "sync",
        "close",
        "unlink:true",
        "open:directory:r",
        "sync",
        "close",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("removes and syncs a partial temporary checkpoint after a write failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-checkpoint-cleanup-"));
    const calls: string[] = [];
    try {
      const checkpoint = createPhase74FileCheckpoint(root, {
        async link() {
          calls.push("link");
        },
        async open(path, flags) {
          const target = path === root
            ? "root"
            : path === join(root, "retrieval")
              ? "directory"
              : "temp";
          calls.push(`open:${target}:${flags}`);
          return {
            async close() {
              calls.push("close");
            },
            async sync() {
              calls.push("sync");
            },
            async writeFile() {
              calls.push("write");
              throw new Error("injected checkpoint write failure");
            },
          };
        },
        randomId: () => "partial",
        async unlink() {
          calls.push("unlink");
        },
      });

      await expect(checkpoint.saveRetrieval("retrieval-key", {
        retrievedMemories: [],
        snapshotId: "snapshot-1",
        storedMemories: [],
      })).rejects.toThrow("injected checkpoint write failure");
      expect(calls).toEqual([
        "open:root:r",
        "sync",
        "close",
        "open:temp:wx",
        "write",
        "close",
        "unlink",
        "open:directory:r",
        "sync",
        "close",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
