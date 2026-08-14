import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import type { GoodMemoryScopeDigest } from "../../src";
import { runCLI } from "../../src/cli";
import {
  createRuntimeWorkerJobEnvelope,
  createRuntimeWorkerQueue,
} from "../../src/runtime-worker/public";

const scopeDigest: GoodMemoryScopeDigest = {
  userIdHash: "hmac-sha256:cli-user",
  workspaceIdHash: "hmac-sha256:cli-workspace",
};

async function withTempQueue<T>(callback: (queueFile: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-runtime-worker-cli-"));
  try {
    return await callback(join(root, "queue.json"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createEnvelope() {
  return createRuntimeWorkerJobEnvelope({
    boundedJob: {
      jobId: "runtime-kit-cli-candidate",
      operation: "remember",
      payloadPreview: "user: alice@example.com | assistant: token sk-cli-secret",
      rawTranscriptPersisted: false,
      reason: "after_model_call",
      status: "candidate",
    },
    createdAt: "2026-04-26T13:30:00.000Z",
    hostKind: "claude",
    scopeDigest,
  });
}

describe("runtime worker CLI", () => {
  it("uses the installed-home runtime-worker.json queue by default", async () => {
    const homeRoot = await mkdtemp(join(tmpdir(), "goodmemory-runtime-worker-home-"));
    const ignoredQueueRoot = await mkdtemp(join(tmpdir(), "goodmemory-runtime-worker-ignored-"));
    try {
      const queueFile = join(homeRoot, ".goodmemory", "runtime-worker.json");
      const queue = createRuntimeWorkerQueue({ queueFile });
      await queue.enqueue(createEnvelope());

      const result = await withEnv({
        GOODMEMORY_HOME: homeRoot,
        GOODMEMORY_RUNTIME_QUEUE_FILE: join(ignoredQueueRoot, "queue.jsonl"),
      }, () => runCLI(["runtime", "worker", "status", "--json"]));

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        queueFile,
        counts: { queued: 1 },
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(ignoredQueueRoot, { force: true, recursive: true });
    }
  });

  it("preserves invalid integer diagnostics", async () => {
    await withTempQueue(async (queueFile) => {
      const result = await runCLI([
        "runtime",
        "worker",
        "drain-once",
        "--queue-file",
        queueFile,
        "--max-jobs",
        "invalid",
      ]);

      expect(result).toEqual({
        exitCode: 1,
        stderr: "Unsupported --max-jobs: invalid. Expected a non-negative integer.",
        stdout: "",
      });
    });
  });

  it("reports, drains, recovers, starts, and stops a local worker queue", async () => {
    await withTempQueue(async (queueFile) => {
      const queue = createRuntimeWorkerQueue({ queueFile });
      await queue.enqueue(createEnvelope());

      const status = await runCLI([
        "runtime",
        "worker",
        "status",
        "--queue-file",
        queueFile,
        "--json",
      ]);
      const drained = await runCLI([
        "runtime",
        "worker",
        "drain-once",
        "--queue-file",
        queueFile,
        "--json",
      ]);
      const recover = await runCLI([
        "runtime",
        "worker",
        "recover",
        "--dry-run",
        "--queue-file",
        queueFile,
        "--json",
      ]);
      const started = await runCLI([
        "runtime",
        "worker",
        "start",
        "--queue-file",
        queueFile,
        "--json",
      ]);
      const stopped = await runCLI([
        "runtime",
        "worker",
        "stop",
        "--queue-file",
        queueFile,
        "--json",
      ]);

      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)).toMatchObject({
        queueFile,
        counts: { queued: 1 },
      });
      expect(JSON.parse(status.stdout).jobsJson).not.toContain("alice@example.com");
      expect(JSON.parse(status.stdout).jobsJson).not.toContain("sk-cli-secret");
      expect(JSON.parse(drained.stdout)).toMatchObject({
        processed: 1,
      });
      expect(JSON.parse(recover.stdout)).toMatchObject({
        dryRun: true,
        mutationApplied: false,
      });
      expect(JSON.parse(started.stdout)).toMatchObject({
        daemon: { enabled: true },
      });
      expect(JSON.parse(stopped.stdout)).toMatchObject({
        daemon: { enabled: false },
      });
    });
  });

  it("renders runtime worker help", async () => {
    const result = await runCLI(["runtime", "worker", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("goodmemory runtime worker drain-once");
    expect(result.stdout).toContain("recover --dry-run");
  });
});
