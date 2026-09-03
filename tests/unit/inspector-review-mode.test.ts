import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GoodMemory, GoodMemoryConfig } from "../../src/api/contracts";
import { readReviewQueue } from "../../src/install/hostReviewQueue";
import { executeInstalledHostWriteback } from "../../src/install/hostWritebackRuntime";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";

async function writeReviewConfig(homeRoot: string): Promise<void> {
  await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
  await writeFile(
    join(homeRoot, ".goodmemory/codex.json"),
    JSON.stringify(
      {
        activationMode: "global",
        host: "codex",
        maxTokens: 128,
        retrievalProfile: "coding_agent",
        storage: {
          path: join(homeRoot, ".goodmemory/memory.sqlite"),
          provider: "sqlite",
        },
        userId: "review-user",
        version: 1,
        writeback: { mode: "review" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function failingMemory(onRemember: () => void): (config: GoodMemoryConfig) => GoodMemory {
  return (_config: GoodMemoryConfig) =>
    ({
      jobs: createNoopGoodMemoryJobsFacade(),
      runtime: createNoopGoodMemoryRuntimeFacade(),
      async buildContext() {
        throw new Error("not used");
      },
      async recall() {
        throw new Error("not used");
      },
      async remember() {
        onRemember();
        throw new Error("review must not write durable memory");
      },
      async forget() {
        throw new Error("not used");
      },
      async importMemory() {
        throw new Error("importMemory is not implemented by this fake.");
      },
      async exportMemory() {
        throw new Error("not used");
      },
      async deleteAllMemory() {
        throw new Error("not used");
      },
      async feedback() {
        throw new Error("not used");
      },
      async reviseMemory() {
        throw new Error("not used");
      },
      async runMaintenance() {
        throw new Error("not used");
      },
    }) satisfies GoodMemory;
}

describe("installed host writeback review mode", () => {
  it("queues durable candidates for review without writing memory", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "gm-review-home-"));
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gm-review-workspace-"));
    let rememberCalled = false;

    try {
      await writeReviewConfig(homeRoot);

      const result = await executeInstalledHostWriteback(
        {
          command: "session-end",
          homeRoot,
          host: "codex",
          payload: {
            cwd: workspaceRoot,
            messages: [
              {
                content: "Always run typecheck before calling the phase done.",
                role: "user",
              },
            ],
            session_id: "session-1",
          },
        },
        {
          createMemory: failingMemory(() => {
            rememberCalled = true;
          }),
        },
      );

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("review");
      expect(result.reason).toBe("review_queued");
      expect(result.wrote).toBe(false);
      expect(rememberCalled).toBe(false);
      expect((result.trace as { reviewQueuedCount?: number }).reviewQueuedCount).toBe(1);

      const queue = await readReviewQueue(homeRoot);
      expect(queue.candidates).toHaveLength(1);
      expect(queue.candidates[0]).toMatchObject({
        status: "pending",
        host: "codex",
        kind: "preference",
        content: "Always run typecheck before calling the phase done.",
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
