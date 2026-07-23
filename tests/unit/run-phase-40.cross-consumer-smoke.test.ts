import { describe, expect, it } from "bun:test";
import {
  buildPhase40CrossConsumerSmokeCommands,
  parsePhase40CrossConsumerSmokeCliOptions,
  resolvePhase40CrossConsumerSmokeOutputDir,
  runPhase40CrossConsumerSmoke,
} from "../../scripts/run-phase-40-cross-consumer-smoke";

describe("run-phase-40 cross-consumer smoke script", () => {
  it("resolves the phase-40 adoption output directory", () => {
    expect(resolvePhase40CrossConsumerSmokeOutputDir("/tmp/goodmemory")).toBe(
      "/tmp/goodmemory/reports/eval/adoption/phase-40",
    );
  });

  it("parses phase-40 cross-consumer smoke cli flags", () => {
    expect(
      parsePhase40CrossConsumerSmokeCliOptions([
        "bun",
        "run",
        "scripts/run-phase-40-cross-consumer-smoke.ts",
        "--output-dir",
        "/tmp/phase40-adoption",
        "--run-id",
        "run-phase40-cross-consumer",
      ]),
    ).toEqual({
      outputDir: "/tmp/phase40-adoption",
      runId: "run-phase40-cross-consumer",
    });
  });

  it("runs every claimed consumer shape with actionable accepted evidence", async () => {
    const writes: Array<{ content: string; path: string }> = [];
    const directories: string[] = [];
    const commands: string[] = [];

    const report = await runPhase40CrossConsumerSmoke(
      {
        outputDir: "/tmp/goodmemory/reports/eval/adoption/phase-40",
        runId: "run-phase40-cross-consumer",
      },
      {
        ensureDir: async (path) => {
          directories.push(path);
        },
        now: () => "2026-04-25T08:30:12.000Z",
        runCommand: async (command) => {
          commands.push(command.label);
          return {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: `${command.label} passed`,
          };
        },
        writeTextFile: async (path, content) => {
          writes.push({ content, path });
        },
      },
    );

    expect(report.phase).toBe("phase-40");
    expect(report.mode).toBe("cross-consumer-adoption-smoke");
    expect(report.acceptance.decision).toBe("accepted");
    expect(report.evidence.directTypeScriptApp.status).toBe("accepted");
    expect(report.evidence.expressHttpServer.status).toBe("accepted");
    expect(report.evidence.fastifyHttpServer.status).toBe("accepted");
    expect(report.evidence.pythonFastApiBridge.status).toBe("accepted");
    expect(report.evidence.installedHostPath.status).toBe("accepted");
    expect(report.evidence.publicEntrypointsOnly.status).toBe("accepted");
    expect(report.evidence.failureVisibility.status).toBe("accepted");
    expect(commands).toEqual([
      "direct-typescript-app",
      "express-http-server",
      "fastify-http-server",
      "python-fastapi-bridge-consumer",
      "installed-host-package-path",
    ]);
    expect(directories).toEqual([
      "/tmp/goodmemory/reports/eval/adoption/phase-40/run-phase40-cross-consumer",
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(
      "/tmp/goodmemory/reports/eval/adoption/phase-40/run-phase40-cross-consumer/report.json",
    );
    expect(JSON.parse(writes[0]!.content)).toEqual(report);
  });

  it("keeps failures visible instead of accepting partial adoption evidence", async () => {
    const report = await runPhase40CrossConsumerSmoke(
      {
        outputDir: "/tmp/goodmemory/reports/eval/adoption/phase-40",
        runId: "run-phase40-cross-consumer",
      },
      {
        ensureDir: async () => undefined,
        now: () => "2026-04-25T08:30:12.000Z",
        runCommand: async (command) => ({
          durationMs: 1,
          exitCode: command.label === "fastify-http-server" ? 1 : 0,
          stderr: command.label === "fastify-http-server"
            ? "Fastify consumer did not recall written memory."
            : "",
          stdout: "",
        }),
        writeTextFile: async () => undefined,
      },
    );

    expect(report.acceptance.decision).toBe("blocked");
    expect(report.acceptance.reason).toContain("fastify-http-server");
    expect(report.evidence.fastifyHttpServer.status).toBe("blocked");
    expect(report.evidence.failureVisibility.status).toBe("accepted");
    expect(report.commands.find((command) => command.status === "failed")).toMatchObject({
      label: "fastify-http-server",
      stderrTail: ["Fastify consumer did not recall written memory."],
    });
  });

  it("builds a public-entrypoint command matrix for the five adoption surfaces", () => {
    expect(
      buildPhase40CrossConsumerSmokeCommands("/repo").map((command) => ({
        args: command.args,
        label: command.label,
      })),
    ).toEqual([
      {
        args: ["bun", "--env-file=/dev/null", "run", "examples/basic-chat.ts"],
        label: "direct-typescript-app",
      },
      {
        args: ["bun", "--env-file=/dev/null", "run", "examples/express-chat-server.ts"],
        label: "express-http-server",
      },
      {
        args: ["bun", "--env-file=/dev/null", "run", "examples/fastify-chat-server.ts"],
        label: "fastify-http-server",
      },
      {
        args: [
          "bun",
          "--env-file=/dev/null",
          "test",
          "tests/release/release.test.ts",
          "--test-name-pattern",
          "installed-package Python bridge smoke covers goodmemory-http-bridge bin and Python consumer",
        ],
        label: "python-fastapi-bridge-consumer",
      },
      {
        args: [
          "bun",
          "--env-file=/dev/null",
          "test",
          "tests/release/release.test.ts",
          "--test-name-pattern",
          "installed-package write CLI smoke covers write -> hook recall -> MCP deep read",
        ],
        label: "installed-host-package-path",
      },
    ]);
  });

  it("isolates public consumer smokes from live provider environment variables", () => {
    const savedProvider = process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER;
    const savedStorageUrl = process.env.GOODMEMORY_STORAGE_URL;

    try {
      process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = "openai";
      process.env.GOODMEMORY_STORAGE_URL = "postgres://user:pass@example/db";

      const command = buildPhase40CrossConsumerSmokeCommands("/repo")[0]!;

      expect(command.env?.PHASE40_CROSS_CONSUMER_SMOKE_IN_PROGRESS).toBe("1");
      expect(command.env?.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER).toBeUndefined();
      expect(command.env?.GOODMEMORY_STORAGE_URL).toBeUndefined();
    } finally {
      if (savedProvider === undefined) {
        delete process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER;
      } else {
        process.env.GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER = savedProvider;
      }

      if (savedStorageUrl === undefined) {
        delete process.env.GOODMEMORY_STORAGE_URL;
      } else {
        process.env.GOODMEMORY_STORAGE_URL = savedStorageUrl;
      }
    }
  });
});
