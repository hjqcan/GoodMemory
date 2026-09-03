import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectC5InstalledHostCanary,
  extractC5MemorySemanticContents,
} from "../../scripts/codex-coding-effect/c5-host-canary";
import {
  hashC5HookContext,
} from "../../scripts/codex-coding-effect/c5-longitudinal-canary";
import type {
  C3InstalledArmRuntime,
} from "../../scripts/codex-coding-effect/c3-runtime";
import type { CodexRunResult } from "../../scripts/codex-coding-effect/codex-runner";
import {
  buildNativeCanarySessionDigest,
} from "../../scripts/codex-coding-effect/native-canary-contracts";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "../../scripts/codex-coding-effect/process";

describe("Codex coding-effect C5 installed host canary", () => {
  it("captures exact native recall and Stop writeback while persisting only sanitized evidence", async () => {
    await withFixture(async ({ codex, evidenceDirectory, runtime, sessionDigest }) => {
      const hookContext = "Durable project rule: preserve the endpoint label.";
      const memoryExportBeforeStage = exportedMemory("Prior memory content.");
      const prompt = "Implement the next endpoint-display task.";
      await writeHostState({
        contentHashes: [hashC5HookContext(hookContext)],
        injectedRecordIds: ["memory-stage-1"],
        runtime,
        sessionDigest,
      });
      await writeTranscript(runtime, codex, prompt, hookContext);
      const requests: BoundaryProcessRequest[] = [];

      const result = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: prompt,
        evidenceDirectory,
        expectedPriorMemoryIds: ["memory-stage-1"],
        memoryExportBeforeStage,
        memoryExpectation: "required",
        runProcess: fakePublicCommands(requests, sessionDigest),
        runtime,
        writebackRequired: true,
      });

      expect(result.canary).toMatchObject({
        currentWrittenMemoryIds: ["memory-stage-2"],
        injectedRecordIds: ["memory-stage-1"],
        memoryChannelStatus: "passed",
        passed: true,
        recalledPriorMemoryIds: ["memory-stage-1"],
        stopCursorAdvanced: true,
        writebackCommitted: true,
      });
      expect(result.liveSurfaces).toEqual([
        {
          content: `${prompt}\n\n${hookContext}`,
          id: "effective-codex-input-after-seeding",
        },
        { content: "", id: "flat-summary-after-seeding" },
        {
          content: memoryExportBeforeStage,
          hiddenValueContents: [
            '{"category":"project","content":"Prior memory content."}',
          ],
          id: "goodmemory-export-after-seeding",
        },
        {
          content: hookContext,
          hiddenValueContents: [hookContext],
          id: "goodmemory-hook-context-after-seeding",
        },
      ]);
      expect(requests.map((request) => request.args[0])).toEqual([
        "codex",
      ]);

      const files = (await readdir(evidenceDirectory)).sort();
      expect(files).toEqual([
        "codex-rollout.sanitized.jsonl",
        "host-canary.sanitized.json",
      ]);
      const persisted = await Promise.all(files.map((file) =>
        readFile(join(evidenceDirectory, file), "utf8")
      ));
      const sanitizedRollout = await readFile(
        join(evidenceDirectory, "codex-rollout.sanitized.jsonl"),
        "utf8",
      );
      const hostCanary = JSON.parse(await readFile(
        join(evidenceDirectory, "host-canary.sanitized.json"),
        "utf8",
      )) as {
        schemaVersion: number;
        sourceReceipts: {
          cursor: { sessionDigests: string[] };
          injection: {
            contentHashes: string[];
            events: Array<{ recordIds: string[] }>;
            injectedRecordIds: string[];
          };
          writeback: {
            events: Array<{
              linkedRecordIds: Array<{ id: string; type: string }>;
            }>;
          };
        };
        sources: { sanitizedTranscriptSha256?: string };
      };
      expect(hostCanary).toMatchObject({
        schemaVersion: 3,
        sourceReceipts: {
          cursor: { sessionDigests: [sessionDigest] },
          injection: {
            contentHashes: [hashC5HookContext(hookContext)],
            events: [{ recordIds: ["memory-stage-1"] }],
            injectedRecordIds: ["memory-stage-1"],
          },
          writeback: {
            events: [{
              linkedRecordIds: [{ id: "memory-stage-2", type: "memory" }],
            }],
          },
        },
      });
      expect(hostCanary.sources.sanitizedTranscriptSha256).toBe(
        createHash("sha256").update(sanitizedRollout).digest("hex"),
      );
      expect(persisted.join("\n")).not.toContain(hookContext);
      expect(persisted.join("\n")).not.toContain(
        "Prior memory content.",
      );
      expect(persisted.join("\n")).not.toContain("redacted by collector");
      expect(persisted.join("\n")).toContain("<redacted-user-text>");
    });
  });

  it("accepts host-generated records from the same isolated pre-stage export", async () => {
    await withFixture(async ({ codex, evidenceDirectory, runtime, sessionDigest }) => {
      const hookContext = "Durable project rule from the prior stage.";
      const exported = JSON.parse(exportedMemory("Explicit writeback memory.")) as {
        durable: { facts: Array<Record<string, unknown>> };
      };
      exported.durable.facts.push({
        ...exported.durable.facts[0],
        content: "Host-generated memory from the same prior stage.",
        id: "memory-automatic-stage-1",
      });
      const memoryExportBeforeStage = `${JSON.stringify(exported)}\n`;
      await writeHostState({
        contentHashes: [hashC5HookContext(hookContext)],
        injectedRecordIds: [
          "memory-stage-1",
          "memory-automatic-stage-1",
        ],
        runtime,
        sessionDigest,
      });
      await writeTranscript(runtime, codex, "Implement stage two.", hookContext);

      const result = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: "Implement stage two.",
        evidenceDirectory,
        expectedPriorMemoryIds: ["memory-stage-1"],
        memoryExportBeforeStage,
        memoryExpectation: "required",
        runProcess: fakePublicCommands([], sessionDigest),
        runtime,
        writebackRequired: false,
      });

      expect(result.canary).toMatchObject({
        injectedRecordIds: [
          "memory-automatic-stage-1",
          "memory-stage-1",
        ],
        memoryChannelStatus: "passed",
        passed: true,
        recalledPriorMemoryIds: [
          "memory-automatic-stage-1",
          "memory-stage-1",
        ],
      });
      expect(result.canary.reasons).toEqual([]);
    });
  });

  it("rejects a pre-stage export that omits prior native Stop lineage", async () => {
    await withFixture(async ({ codex, evidenceDirectory, runtime, sessionDigest }) => {
      const hookContext = "Durable project rule from an unbound record.";
      const exported = JSON.parse(exportedMemory("Unbound memory.")) as {
        durable: { facts: Array<Record<string, unknown>> };
      };
      exported.durable.facts[0]!.id = "memory-automatic-stage-1";
      const memoryExportBeforeStage = `${JSON.stringify(exported)}\n`;
      await writeHostState({
        contentHashes: [hashC5HookContext(hookContext)],
        injectedRecordIds: ["memory-automatic-stage-1"],
        runtime,
        sessionDigest,
      });
      await writeTranscript(runtime, codex, "Implement stage two.", hookContext);

      const result = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: "Implement stage two.",
        evidenceDirectory,
        expectedPriorMemoryIds: ["memory-stage-1"],
        memoryExportBeforeStage,
        memoryExpectation: "required",
        runProcess: fakePublicCommands([], sessionDigest),
        runtime,
        writebackRequired: false,
      });

      expect(result.canary.memoryChannelStatus).toBe("failed");
      expect(result.canary.reasons).toContain(
        "pre-stage memory export omits prior native Stop lineage",
      );
    });
  });

  it("fails the required memory channel when a hash receipt cannot recover actual hook context", async () => {
    await withFixture(async ({ codex, evidenceDirectory, runtime, sessionDigest }) => {
      const missingContext = "Context that is absent from the exact transcript.";
      const memoryExportBeforeStage = exportedMemory("Prior memory content.");
      await writeHostState({
        contentHashes: [hashC5HookContext(missingContext)],
        injectedRecordIds: ["memory-stage-1"],
        runtime,
        sessionDigest,
      });
      await writeTranscript(runtime, codex, "Implement stage two.", "different text");

      const result = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: "Implement stage two.",
        evidenceDirectory,
        expectedPriorMemoryIds: ["memory-stage-1"],
        memoryExportBeforeStage,
        memoryExpectation: "required",
        runProcess: fakePublicCommands([], sessionDigest),
        runtime,
        writebackRequired: true,
      });

      expect(result.canary.memoryChannelStatus).toBe("failed");
      expect(result.canary.reasons).toContain(
        "actual injected hook context was not recoverable from the exact transcript",
      );
      expect(result.liveSurfaces.find((surface) =>
        surface.id === "goodmemory-hook-context-after-seeding"
      )?.content).toBe("");
    });
  });

  it("projects transcript collection failures without persisting paths or thread IDs", async () => {
    await withFixture(async ({ codex, evidenceDirectory, root, runtime, sessionDigest }) => {
      const memoryExportBeforeStage = exportedMemory("Prior memory content.");
      await writeHostState({
        contentHashes: [],
        injectedRecordIds: [],
        runtime,
        sessionDigest,
      });

      const result = await collectC5InstalledHostCanary({
        codex,
        effectivePrompt: "Implement stage two.",
        evidenceDirectory,
        expectedPriorMemoryIds: ["memory-stage-1"],
        memoryExportBeforeStage,
        memoryExpectation: "none",
        runProcess: fakePublicCommands([], sessionDigest),
        runtime,
        writebackRequired: false,
      });

      expect(result.canary).toMatchObject({
        memoryChannelStatus: "failed",
        passed: false,
      });
      expect(result.canary.reasons).toContain(
        "source-collection-failed:codex-transcript",
      );
      expect(result.sanitizedTranscriptSha256).toMatch(/^[a-f0-9]{64}$/u);

      const persisted = (await Promise.all((await readdir(evidenceDirectory)).map(
        (file) => readFile(join(evidenceDirectory, file), "utf8"),
      ))).join("\n");
      expect(persisted).toContain('\"type\":\"source_failure\"');
      expect(persisted).not.toContain(root);
      expect(persisted).not.toContain(".goodmemory");
      expect(persisted).not.toContain("thread-c5-installed-001");
    });
  });

  it("audits nested semantic values while excluding pure record metadata", () => {
    const documents = extractC5MemorySemanticContents(exportedMemory(
      "Prior memory content.",
      {
        attributes: {
          hiddenBoolean: true,
          hiddenNumber: 731,
          hiddenString: "semantic-marker",
        },
        confidence: 0.73,
        importance: 0.91,
        tags: ["durable-policy"],
        verificationPressureCount: 2,
      },
    ));

    expect(documents).toEqual([
      '{"category":"project","content":"Prior memory content.","tags":["durable-policy"],"attributes":{"hiddenBoolean":true,"hiddenNumber":731,"hiddenString":"semantic-marker"}}',
    ]);
    expect(documents.join("\n")).not.toContain('"verificationPressureCount"');
    expect(documents.join("\n")).not.toContain('"confidence"');
    expect(documents.join("\n")).not.toContain('"importance"');
    expect(documents.join("\n")).not.toContain('"verificationPressureCount"');
  });

  it("fails closed for unknown durable collections and record fields", () => {
    const withPages = JSON.parse(exportedMemory("Known memory.")) as
      Record<string, unknown>;
    withPages.pages = {
      files: [],
      manifest: { files: [], format: "goodmemory.pages/v1", pageCount: 0 },
      rootPath: "pages",
    };
    expect(extractC5MemorySemanticContents(JSON.stringify(withPages)))
      .toHaveLength(1);

    const unknownTopLevel = JSON.parse(exportedMemory("Known memory.")) as
      Record<string, unknown>;
    unknownTopLevel.futureSemanticSurface = "silent leak";
    expect(() => extractC5MemorySemanticContents(
      JSON.stringify(unknownTopLevel),
    )).toThrow(
      "C5 memory export root has unknown field futureSemanticSurface",
    );

    const unknownCollection = JSON.parse(exportedMemory("Known memory.")) as {
      durable: Record<string, unknown>;
    };
    unknownCollection.durable.futureMemories = [];
    expect(() => extractC5MemorySemanticContents(
      JSON.stringify(unknownCollection),
    )).toThrow("C5 memory export durable has unknown field futureMemories");

    expect(() => extractC5MemorySemanticContents(exportedMemory(
      "Known memory.",
      { futureSemanticField: "silent leak" },
    ))).toThrow(
      "C5 memory export facts[0] has unknown field futureSemanticField",
    );
  });
});

async function withFixture(
  run: (fixture: {
    codex: CodexRunResult;
    evidenceDirectory: string;
    root: string;
    runtime: C3InstalledArmRuntime;
    sessionDigest: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-host-canary-"));
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const evidenceDirectory = join(root, "evidence");
  const workspace = join(root, "workspace");
  await Promise.all([
    mkdir(join(codexHome, "sessions", "2026", "07", "16"), {
      recursive: true,
    }),
    mkdir(join(home, ".goodmemory"), { recursive: true }),
    mkdir(evidenceDirectory, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  const threadId = "thread-c5-installed-001";
  const sessionDigest = buildNativeCanarySessionDigest(threadId);
  const runtime = installedRuntime({ codexHome, home, root, workspace });
  const codex = completedCodex(threadId);
  try {
    await run({ codex, evidenceDirectory, root, runtime, sessionDigest });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function installedRuntime(input: {
  codexHome: string;
  home: string;
  root: string;
  workspace: string;
}): C3InstalledArmRuntime {
  return {
    codex: {
      executable: "/fake/codex",
      executableSha256: "a".repeat(64),
      hooksEnabled: true,
      version: "codex-cli 0.144.5",
    },
    env: {
      CODEX_HOME: input.codexHome,
      HOME: input.home,
      PATH: "/fake/bin:/usr/bin:/bin",
    },
    goodmemoryExecutable: "/fake/bin/goodmemory",
    instructionSha256: "b".repeat(64),
    package: { sha256: "c".repeat(64), version: "0.5.1" },
    permissionProfile: {
      configSha256: "d".repeat(64),
      filesystemDefault: "deny",
      minimalRead: true,
      name: "c3-task",
      networkAccess: false,
      workspaceWrite: true,
    },
    plan: {
      arm: "goodmemory-installed",
      paths: {
        armRoot: input.root,
        cache: join(input.root, "cache"),
        codexHome: input.codexHome,
        home: input.home,
        packagePrefix: join(input.root, "prefix"),
        result: join(input.root, "result"),
        temp: join(input.root, "tmp"),
        workspace: input.workspace,
      },
      scopes: {
        sessionId: "c5-session",
        userId: "c5-user",
        workspaceId: "c5-workspace",
      },
    },
    preexistingSessionCount: 0,
    profile: {
      activationMode: "global",
      hookRegistered: true,
      mcpRegistered: true,
      persistRawTranscript: false,
      retrievalProfile: "coding_agent",
      workspaceStatus: "ok",
      writebackMode: "selective",
    },
    storagePath: join(input.root, "memory.sqlite"),
  };
}

function completedCodex(threadId: string): CodexRunResult {
  return {
    durationMs: 1,
    events: [],
    exitCode: 0,
    normalized: {
      commands: [],
      fileChanges: [],
      finalMessage: "done",
      finalMessageEventIndex: 2,
      threadId,
      threadStartedEventIndex: 0,
      usage: { cachedInputTokens: 0, inputTokens: 1, outputTokens: 1 },
      usageEventIndex: 3,
    },
    status: "completed",
    stderr: "",
    stdout: "{}\n",
    timedOut: false,
  };
}

async function writeHostState(input: {
  contentHashes: string[];
  injectedRecordIds: string[];
  runtime: C3InstalledArmRuntime;
  sessionDigest: string;
}): Promise<void> {
  const goodmemory = join(input.runtime.plan.paths.home, ".goodmemory");
  await Promise.all([
    writeFile(
      join(goodmemory, "codex-injection-state.json"),
      `${JSON.stringify({
        events: [{
          command: "user-prompt-submit",
          decision: "injected",
          recordIds: input.injectedRecordIds,
          sessionDigest: input.sessionDigest,
        }],
        sessions: {
          [input.sessionDigest]: {
            contentHashes: input.contentHashes,
            injectedRecordIds: input.injectedRecordIds,
            updatedAt: "2026-07-16T00:00:00.000Z",
          },
        },
        version: 1,
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(goodmemory, "codex-transcript-cursors.json"),
      `${JSON.stringify({
        cursors: {
          [input.sessionDigest]: {
            offset: 100,
            updatedAt: "2026-07-16T00:00:01.000Z",
          },
        },
        version: 1,
      })}\n`,
      "utf8",
    ),
  ]);
}

async function writeTranscript(
  runtime: C3InstalledArmRuntime,
  codex: CodexRunResult,
  prompt: string,
  hookContext: string,
): Promise<void> {
  const threadId = codex.normalized!.threadId!;
  const raw = [
    { payload: { id: threadId }, type: "session_meta" },
    {
      payload: {
        content: [{ text: prompt, type: "input_text" }],
        role: "user",
        type: "message",
      },
      type: "response_item",
    },
    {
      payload: {
        content: [{ text: hookContext, type: "input_text" }],
        role: "developer",
        type: "message",
      },
      type: "response_item",
    },
    {
      payload: {
        content: [{ text: "done", type: "output_text" }],
        role: "assistant",
        type: "message",
      },
      type: "response_item",
    },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
  await writeFile(
    join(
      runtime.plan.paths.codexHome,
      "sessions",
      "2026",
      "07",
      "16",
      `rollout-2026-07-16T00-00-00-${threadId}.jsonl`,
    ),
    raw,
    "utf8",
  );
}

function exportedMemory(
  content: string,
  factOverrides: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({
    artifacts: {
      files: {},
      manifest: {
        generatedAt: "2026-07-16T00:00:00.000Z",
        scope: { userId: "c5-user", workspaceId: "c5-workspace" },
        sections: [],
      },
      markdown: "",
    },
    durable: {
      archives: [],
      episodes: [],
      evidence: [],
      experiences: [],
      facts: [{
        category: "project",
        confidence: 1,
        content,
        createdAt: "2026-07-16T00:00:00.000Z",
        id: "memory-stage-1",
        importance: 1,
        isActive: true,
        lifecycle: "active",
        source: {
          extractedAt: "2026-07-16T00:00:00.000Z",
          method: "confirmed",
        },
        updatedAt: "2026-07-16T00:00:00.000Z",
        userId: "c5-user",
        ...factOverrides,
      }],
      feedback: [],
      preferences: [],
      profile: null,
      promotions: [],
      proposals: [],
      references: [],
      sourceMessages: [],
    },
    exportedAt: "2026-07-16T00:00:00.000Z",
    scope: { userId: "c5-user", workspaceId: "c5-workspace" },
  })}\n`;
}

function fakePublicCommands(
  requests: BoundaryProcessRequest[],
  sessionDigest: string,
): (request: BoundaryProcessRequest) => Promise<BoundaryProcessResult> {
  return async (request) => {
    requests.push(request);
    if (request.args[0] === "codex") {
      return processResult(`${JSON.stringify({
        events: [{
          command: "turn-end",
          contentPreview: "redacted by collector",
          linkedRecordIds: [{ id: "memory-stage-2", type: "memory" }],
          recallHitCount: 1,
          recalledBy: [{ sessionDigest }],
          sessionDigest,
          status: "committed",
        }],
        host: "codex",
      })}\n`);
    }
    throw new Error(`unexpected public command ${request.args.join(" ")}`);
  };
}

function processResult(stdout: string): BoundaryProcessResult {
  return {
    durationMs: 1,
    exitCode: 0,
    stderr: "",
    stdout,
    timedOut: false,
  };
}
