import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GoodMemoryConfig } from "../../src/api/contracts";
import { createGoodMemory } from "../../src";
import { parseInstalledHostRuntimeConfig } from "../../src/install/hostConfigValidation";
import {
  createInstalledHostMemory,
  type HostMemoryRuntimeContext,
} from "../../src/install/hostExecutionContext";
import { installHost } from "../../src/install/hostInstall";

// The file mirror is the installed host's greppable view of durable memory
// (ADR-010 §8). It is opt-in: absence keeps every write byte-identical.

const SCRATCH =
  "/private/tmp/claude-501/-Users-hjqcan-workspace-GoodMemory/cd707382-ae3b-4889-98c1-ba694a90813c/scratchpad";

function baseConfig(fileMirror?: unknown): Record<string, unknown> {
  return {
    host: "claude",
    ...(fileMirror !== undefined ? { fileMirror } : {}),
    storage: {
      path: "/tmp/goodmemory.sqlite",
      provider: "sqlite",
    },
    userId: "user-1",
    version: 1,
  };
}

function runtimeContext(
  fileMirror?: HostMemoryRuntimeContext["fileMirror"],
): HostMemoryRuntimeContext {
  return {
    activationMode: "global",
    contextMode: "fragment",
    debug: false,
    ...(fileMirror ? { fileMirror } : {}),
    host: "claude",
    maxTokens: 256,
    retrievalProfile: "coding_agent",
    scope: { agentId: "claude", userId: "user-1", workspaceId: "ws-1" },
    storage: { provider: "memory" },
    writeback: {
      allowAssistantOutput: "confirmed_or_verified",
      dryRun: false,
      maxChars: 4000,
      maxMessages: 20,
      minConfidence: 0.6,
      mode: "off",
      persistRawTranscript: false,
    },
    workspaceRoot: "/repo/project",
  };
}

describe("installed host file mirror config", () => {
  it("omits the field when absent and round-trips enabled plus root", () => {
    const absent = parseInstalledHostRuntimeConfig(baseConfig(), "claude");
    expect(absent.status).toBe("ok");
    if (absent.status !== "ok") {
      return;
    }
    expect("fileMirror" in absent.config).toBe(false);

    const enabled = parseInstalledHostRuntimeConfig(baseConfig({ enabled: true }), "claude");
    expect(enabled.status === "ok" && enabled.config.fileMirror).toEqual({ enabled: true });

    const rooted = parseInstalledHostRuntimeConfig(
      baseConfig({ enabled: true, root: "/srv/memory-mirror" }),
      "claude",
    );
    expect(rooted.status === "ok" && rooted.config.fileMirror).toEqual({
      enabled: true,
      root: "/srv/memory-mirror",
    });
  });

  it("rejects malformed fileMirror sections field by field", () => {
    expect(parseInstalledHostRuntimeConfig(baseConfig("yes"), "claude")).toEqual({
      detail: "fileMirror must be a JSON object",
      status: "invalid",
    });
    expect(parseInstalledHostRuntimeConfig(baseConfig({ root: "/x" }), "claude")).toEqual({
      detail: "fileMirror.enabled must be a boolean",
      status: "invalid",
    });
    expect(
      parseInstalledHostRuntimeConfig(baseConfig({ enabled: true, root: " " }), "claude"),
    ).toEqual({
      detail: "fileMirror.root must be a non-empty string",
      status: "invalid",
    });
  });

  it("hands the mirror root to createGoodMemory only when enabled", () => {
    const configs: GoodMemoryConfig[] = [];
    const createMemory = (config: GoodMemoryConfig) => {
      configs.push(config);
      return createGoodMemory({ storage: { provider: "memory" } });
    };

    createInstalledHostMemory(runtimeContext(), { createMemory });
    createInstalledHostMemory(runtimeContext({ enabled: false, root: "/elsewhere" }), { createMemory });
    createInstalledHostMemory(runtimeContext({ enabled: true }), { createMemory });
    createInstalledHostMemory(runtimeContext({ enabled: true, root: "/elsewhere" }), { createMemory });

    // The mirror binds to the workspace's durable scope, not to the host agent:
    // every agent writing into this workspace regenerates the same tree.
    const boundScope = { userId: "user-1", workspaceId: "ws-1" };
    expect(configs.map((config) => config.governance)).toEqual([
      undefined,
      undefined,
      { fileMirror: { root: join("/repo/project", ".goodmemory", "memory"), scope: boundScope } },
      { fileMirror: { root: "/elsewhere", scope: boundScope } },
    ]);
  });

  it("writes fileMirror on install, preserves it on reinstall, and lets a later install override it", async () => {
    const homeRoot = await mkdtemp(join(SCRATCH, "file-mirror-install-"));
    try {
      await installHost({ fileMirror: { enabled: true }, homeRoot, host: "codex", userId: "user-1" });
      const readConfig = async () =>
        JSON.parse(await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8")) as {
          fileMirror?: unknown;
        };
      expect((await readConfig()).fileMirror).toEqual({ enabled: true });

      await installHost({ homeRoot, host: "codex", userId: "user-1" });
      expect((await readConfig()).fileMirror).toEqual({ enabled: true });

      await installHost({ fileMirror: { enabled: false }, homeRoot, host: "codex", userId: "user-1" });
      expect((await readConfig()).fileMirror).toEqual({ enabled: false });

      const plainRoot = await mkdtemp(join(SCRATCH, "file-mirror-install-plain-"));
      try {
        await installHost({ homeRoot: plainRoot, host: "codex", userId: "user-1" });
        const plain = JSON.parse(
          await readFile(join(plainRoot, ".goodmemory/codex.json"), "utf8"),
        ) as Record<string, unknown>;
        expect("fileMirror" in plain).toBe(false);
      } finally {
        await rm(plainRoot, { force: true, recursive: true });
      }
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });
});
