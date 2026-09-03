import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  initializeC5EmptyInstalledStorage,
  replaceC5TrajectoryWorkspace,
  resolveC5CodexStageInput,
  resolveC5PriorStageTrajectoryOrigins,
  sanitizeC5StageEvents,
} from "../../scripts/codex-coding-effect/c5-native-adapter";

describe("Codex coding-effect C5 native stage input", () => {
  it("replaces the whole stage clone so ignored files and Git metadata cannot cross stages", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-stage-clone-"));
    const source = join(root, "source");
    const workspace = join(root, "workspace");
    try {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, ".gitignore"), "ignored.txt\n", "utf8");
      await writeFile(join(source, "tracked.txt"), "frozen\n", "utf8");
      await git(source, ["init", "--quiet"]);
      await git(source, ["config", "user.email", "c5@example.invalid"]);
      await git(source, ["config", "user.name", "C5 Test"]);
      await git(source, ["add", "."]);
      await git(source, ["commit", "--quiet", "-m", "frozen"]);
      const commit = await git(source, ["rev-parse", "HEAD"]);

      await replaceC5TrajectoryWorkspace({
        destination: workspace,
        expectedCommit: commit,
        sourceRepository: source,
      });
      await writeFile(join(workspace, "ignored.txt"), "cross-stage\n", "utf8");
      await git(workspace, ["config", "c5.crossStage", "true"]);
      await writeFile(join(workspace, ".git", "hooks", "post-checkout"), "cross-stage\n", "utf8");
      await writeFile(join(workspace, ".git", "info", "exclude"), "cross-stage\n", "utf8");

      await replaceC5TrajectoryWorkspace({
        destination: workspace,
        expectedCommit: commit,
        sourceRepository: source,
      });

      expect(await Bun.file(join(workspace, "ignored.txt")).exists()).toBe(false);
      expect(await git(workspace, ["config", "--get", "c5.crossStage"], true)).toBe("");
      expect(await Bun.file(join(workspace, ".git", "hooks", "post-checkout")).exists())
        .toBe(false);
      expect(await readFile(join(workspace, ".git", "info", "exclude"), "utf8"))
        .not.toContain("cross-stage");
      expect(await git(workspace, ["status", "--porcelain=v1", "--ignored"])).toBe("");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("includes allowed feedback and preserves the run-level Codex timeout", () => {
    expect(resolveC5CodexStageInput({
      allowedFeedback: ["Reuse the validated first-delimiter rule."],
      prompt: "Repair the parser.",
      stageTimeoutMs: 900_000,
    })).toEqual({
      prompt: [
        "Repair the parser.",
        "",
        "Prior user-visible feedback:",
        "Reuse the validated first-delimiter rule.",
      ].join("\n"),
      timeoutMs: 900_000,
    });
  });

  it("attests prior Codex output as the source of native Stop memory", () => {
    expect(resolveC5PriorStageTrajectoryOrigins({
      codexStdout: '{"type":"item.completed","text":"process.exit(1);"}\n',
      patch: "+export const mode = 'buffered';\n",
      prompt: "Implement the accepted setting policy.",
      stageId: "stage-1",
    })).toEqual([
      {
        content: "Implement the accepted setting policy.",
        id: "stage-1:effective-prompt",
      },
      {
        content: "+export const mode = 'buffered';\n",
        id: "stage-1:agent-patch",
      },
      {
        content: '{"type":"item.completed","text":"process.exit(1);"}\n',
        id: "stage-1:codex-jsonl-output",
      },
    ]);
  });

  it("removes executable paths and raw failure text from persisted stage events", () => {
    const context = {
      arm: "goodmemory-installed" as const,
      attemptId: "attempt-1",
      episodeId: "episode-1",
      repetition: 1,
      runId: "run-1",
      seed: 73,
      stageId: "stage-1",
      timestamp: "2026-07-16T00:00:00.000Z",
      traceId: "trace-1",
    };
    const sanitized = sanitizeC5StageEvents({
      codexExecutableSha256: "a".repeat(64),
      events: [
        {
          ...context,
          details: {
            argumentCount: 12,
            executable: "/private/runtime/arm/bin/codex",
          },
          event: "codex_process_started",
        },
        {
          ...context,
          details: { error: "parse failed near /private/runtime/secret" },
          event: "codex_event_parse_failed",
        },
        {
          ...context,
          details: {
            failureEvents: [{ message: "secret model failure body" }],
          },
          event: "codex_process_failure",
        },
      ],
    });

    expect(sanitized.map((event) => event.details)).toEqual([
      {
        argumentCount: 12,
        executableSha256: "a".repeat(64),
      },
      {
        errorSha256:
          "3295f46da506e04ff559be2fcfa547ff65c8219fb7abf802d9db9a78ce82e4a6",
      },
      {
        failureEventCount: 1,
        failureEventsSha256:
          "761547c4c2c15699de6efa3fbc614fb3d14d750bb457408e4b7405cfbff75831",
      },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain("/private/runtime");
    expect(JSON.stringify(sanitized)).not.toContain("secret model failure body");
  });

  it("initializes a missing installed sqlite store without writing memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-empty-storage-"));
    const storagePath = join(root, "memory.sqlite");
    const requests: Array<{ args: readonly string[] }> = [];
    try {
      const status = await initializeC5EmptyInstalledStorage({
        env: {},
        executable: "/installed/bin/goodmemory",
        run: async (request) => {
          requests.push(request);
          await writeFile(storagePath, "initialized", "utf8");
          return {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: `${JSON.stringify({
              deleted: {
                archives: 0,
                artifactSpills: 0,
                episodes: 0,
                evidence: 0,
                experiences: 0,
                facts: 0,
                feedback: 0,
                journal: 0,
                preferences: 0,
                profiles: 0,
                promotions: 0,
                proposals: 0,
                references: 0,
                workingMemory: 0,
              },
              includeRuntime: false,
              scope: {
                userId: "user-1",
                workspaceId: "workspace-1",
              },
              storage: {
                location: storagePath,
                provider: "sqlite",
              },
            })}\n`,
            timedOut: false,
          };
        },
        storagePath,
        timeoutMs: 30_000,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceRoot: root,
      });

      expect(status).toBe("initialized");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.args).toEqual([
        "forget",
        "--all",
        "--user-id",
        "user-1",
        "--workspace-id",
        "workspace-1",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        storagePath,
        "--json",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not reinitialize an existing installed sqlite store", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-existing-storage-"));
    const storagePath = join(root, "memory.sqlite");
    try {
      await writeFile(storagePath, "existing", "utf8");
      expect(await initializeC5EmptyInstalledStorage({
        env: {},
        executable: "/installed/bin/goodmemory",
        run: async () => {
          throw new Error("initializer must not run");
        },
        storagePath,
        timeoutMs: 30_000,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceRoot: root,
      })).toBe("already-initialized");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts additional zero-count memory kinds but rejects missing kinds or non-zero extras", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-storage-kinds-"));
    const storagePath = join(root, "memory.sqlite");
    const knownKinds = [
      "archives",
      "artifactSpills",
      "episodes",
      "evidence",
      "experiences",
      "facts",
      "feedback",
      "journal",
      "preferences",
      "profiles",
      "promotions",
      "proposals",
      "references",
      "workingMemory",
    ];
    const initialize = (deleted: Record<string, number>) =>
      initializeC5EmptyInstalledStorage({
        env: {},
        executable: "/installed/bin/goodmemory",
        run: async () => {
          await writeFile(storagePath, "initialized", "utf8");
          return {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: `${JSON.stringify({
              deleted,
              includeRuntime: false,
              scope: { userId: "user-1", workspaceId: "workspace-1" },
              storage: { location: storagePath, provider: "sqlite" },
            })}\n`,
            timedOut: false,
          };
        },
        storagePath,
        timeoutMs: 30_000,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceRoot: root,
      });
    const zeros = (keys: readonly string[]) =>
      Object.fromEntries(keys.map((key) => [key, 0]));
    try {
      expect(await initialize({ ...zeros(knownKinds), notes: 0 })).toBe("initialized");
      await rm(storagePath, { force: true });
      await expect(initialize({ ...zeros(knownKinds), notes: 2 }))
        .rejects.toThrow("not empty and bound");
      await rm(storagePath, { force: true });
      await expect(initialize(zeros(knownKinds.filter((key) => key !== "journal"))))
        .rejects.toThrow("not empty and bound");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an initialization receipt that deleted preexisting memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-dirty-storage-"));
    const storagePath = join(root, "memory.sqlite");
    try {
      await expect(initializeC5EmptyInstalledStorage({
        env: {},
        executable: "/installed/bin/goodmemory",
        run: async () => {
          await writeFile(storagePath, "initialized", "utf8");
          return {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: `${JSON.stringify({
              deleted: Object.fromEntries(
                [
                  "archives",
                  "artifactSpills",
                  "episodes",
                  "evidence",
                  "experiences",
                  "facts",
                  "feedback",
                  "journal",
                  "preferences",
                  "profiles",
                  "promotions",
                  "proposals",
                  "references",
                  "workingMemory",
                ].map((key) => [key, key === "experiences" ? 1 : 0]),
              ),
              includeRuntime: false,
              scope: {
                userId: "user-1",
                workspaceId: "workspace-1",
              },
              storage: {
                location: storagePath,
                provider: "sqlite",
              },
            })}\n`,
            timedOut: false,
          };
        },
        storagePath,
        timeoutMs: 30_000,
        userId: "user-1",
        workspaceId: "workspace-1",
        workspaceRoot: root,
      })).rejects.toThrow("receipt is not empty and bound");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function git(
  cwd: string,
  args: readonly string[],
  allowFailure = false,
): Promise<string> {
  const process = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(stderr);
  }
  return stdout.trim();
}
