import { describe, expect, it } from "bun:test";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPackageTarballName,
  loadPackageMetadataSync,
} from "../../scripts/package-metadata";
import { withPackagePackLock } from "../support/package-pack-lock";

const ROOT_PACKAGE_PATH = join(import.meta.dir, "../../");
const CURRENT_TARBALL_NAME = buildPackageTarballName(
  loadPackageMetadataSync(ROOT_PACKAGE_PATH),
);
const RELEASE_TEST_ENV = {
  GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_MODEL: undefined,
  GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER: undefined,
  GOODMEMORY_EMBEDDING_API_KEY: undefined,
  GOODMEMORY_EMBEDDING_BASE_URL: undefined,
  GOODMEMORY_EMBEDDING_MODEL: undefined,
  GOODMEMORY_EMBEDDING_PROVIDER: undefined,
  GOODMEMORY_JUDGE_API_KEY: undefined,
  GOODMEMORY_JUDGE_BASE_URL: undefined,
  GOODMEMORY_JUDGE_MODEL: undefined,
  GOODMEMORY_JUDGE_PROVIDER: undefined,
  GOODMEMORY_RECALL_ROUTER_API_KEY: undefined,
  GOODMEMORY_RECALL_ROUTER_BASE_URL: undefined,
  GOODMEMORY_RECALL_ROUTER_MODEL: undefined,
  GOODMEMORY_RECALL_ROUTER_PROVIDER: undefined,
  GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH: undefined,
  GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT: undefined,
  GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
  GOODMEMORY_SQLITE_VECTOR_MODE: undefined,
  GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: undefined,
  GOODMEMORY_STORAGE_PROVIDER: undefined,
  GOODMEMORY_STORAGE_URL: undefined,
  GOODMEMORY_TEST_POSTGRES_URL: undefined,
} as const;

function createChildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function runCommand(input: {
  cmd: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const childProcess = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    env: createChildEnv(input.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(childProcess.stdout).text();
  const stderr = await new Response(childProcess.stderr).text();
  const exitCode = await childProcess.exited;

  return {
    exitCode,
    stderr,
    stdout,
  };
}

function extractJsonObject<T>(value: string): T {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Expected JSON output but none was found.");
  }

  return JSON.parse(value.slice(start, end + 1)) as T;
}

function allocateBridgePort(): number {
  const server = Bun.serve({
    fetch: () => new Response("ok"),
    port: 0,
  });
  const port = server.port;
  server.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not allocate a package-boundary bridge test port.");
  }

  return port;
}

async function waitForInstalledHttpBridgeReady(input: {
  token: string;
  url: string;
}): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${input.url}/memory/recall-context`, {
        body: JSON.stringify({
          query: "health check",
          scope: {
            agentId: "life-coach",
            sessionId: "package-boundary-health",
            userId: "python-user",
            workspaceId: "life-workspace",
          },
        }),
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
          "x-goodmemory-operations": "recall-context",
          "x-goodmemory-user-id": "python-user",
          "x-goodmemory-workspace-id": "life-workspace",
        },
        method: "POST",
      });

      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }

      lastError = new Error(`Installed bridge returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(75);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Installed GoodMemory HTTP bridge did not become ready.");
}

async function packReleaseTarball(outputDir: string): Promise<string> {
  const pack = await withPackagePackLock(ROOT_PACKAGE_PATH, () =>
    runCommand({
      cmd: ["bun", "pm", "pack", "--destination", outputDir, "--quiet"],
      cwd: ROOT_PACKAGE_PATH,
    }),
  );

  expect(pack.exitCode).toBe(0);
  const tarballOutput = pack.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);
  return tarballOutput?.includes("/")
    ? tarballOutput
    : join(outputDir, tarballOutput ?? CURRENT_TARBALL_NAME);
}

describe("node package boundary", () => {
  it("installs from the packed artifact in npm and runs the canonical public library path under Node", async () => {
    const fixtureRoot = join(
      ROOT_PACKAGE_PATH,
      "tests/consumers/reference-package-smoke",
    );
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-node-reference-consumer-"),
    );
    const packOutputDir = await mkdtemp(
      join(tmpdir(), "goodmemory-node-reference-pack-"),
    );

    try {
      const tarballPath = await packReleaseTarball(packOutputDir);
      await cp(fixtureRoot, workspaceRoot, { recursive: true });

      const packageJsonPath = join(workspaceRoot, "package.json");
      const packageJson = await readFile(packageJsonPath, "utf8");
      await writeFile(
        packageJsonPath,
        packageJson.replace(
          "__GOODMEMORY_PACKAGE_SPEC__",
          `file:${tarballPath}`,
        ),
        "utf8",
      );

      const install = await runCommand({
        cmd: ["npm", "install"],
        cwd: workspaceRoot,
      });
      expect(install.exitCode).toBe(0);

      const smoke = await runCommand({
        cmd: ["npm", "run", "smoke:node"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(smoke.exitCode).toBe(0);
      const smokeJson = extractJsonObject<{
        aiSDKResponseText: string;
        artifactPaths: string[];
        contextIncludesChecklist: boolean;
        httpBridgeContextIncludesPackageImport: boolean;
        httpBridgeItemCount: number;
        httpBridgeRememberOk: boolean;
        explicitPostgresRememberError?: string;
        explicitPostgresRuntimeInfo?: {
          assistedExtractionEnabled: boolean;
          embeddingEnabled: boolean;
          explicitAdaptersConfigured: boolean;
          explicitStorageConfigured: boolean;
          storage: {
            durability:
              | "conditional"
              | "durable"
              | "ephemeral"
              | "unavailable";
            mode: "auto" | "explicit";
            postgresConfigured: boolean;
            primaryProvider: "memory" | "postgres" | "sqlite";
            unavailableReason?: "runtime_without_builtin_postgres";
          };
        };
        explicitSqliteRememberError?: string;
        explicitSqliteRuntimeInfo?: {
          assistedExtractionEnabled: boolean;
          embeddingEnabled: boolean;
          explicitAdaptersConfigured: boolean;
          explicitStorageConfigured: boolean;
          storage: {
            durability:
              | "conditional"
              | "durable"
              | "ephemeral"
              | "unavailable";
            mode: "auto" | "explicit";
            postgresConfigured: boolean;
            primaryProvider: "memory" | "postgres" | "sqlite";
            sqliteUrl?: string;
            unavailableReason?: "runtime_without_builtin_sqlite";
          };
        };
        invalidScopeError?: string;
        invalidScopeStatus: number;
        frenchPackId: string;
        frenchSearchTerms: string[];
        japanesePackId: string;
        japaneseSearchTerms: string[];
        koreanPackId: string;
        koreanSearchTerms: string[];
        ok: boolean;
        recallHitCount: number;
        runtimeInfo?: {
          assistedExtractionEnabled: boolean;
          embeddingEnabled: boolean;
          explicitAdaptersConfigured: boolean;
          explicitStorageConfigured: boolean;
          storage: {
            durability:
              | "conditional"
              | "durable"
              | "ephemeral"
              | "unavailable";
            fallbackReason?: "runtime_without_local_sqlite";
            mode: "auto" | "explicit";
            postgresConfigured: boolean;
            primaryProvider: "memory" | "postgres" | "sqlite";
          };
        };
        serverFirstResponseText: string;
        serverRecallApplied: boolean;
        serverRememberSucceeded: boolean;
        serverSecondResponseText: string;
        serverSecondSystem?: string;
        spanishPackId: string;
        spanishSearchTerms: string[];
        traditionalChinesePackId: string;
        traditionalChineseSearchTerms: string[];
        validatedFileEditPath?: string;
        validatedToolPayloadShape?: string;
      }>(smoke.stdout);
      expect(smokeJson.ok).toBe(true);
      expect(smokeJson.aiSDKResponseText).toContain("Noted.");
      expect(smokeJson.contextIncludesChecklist).toBe(true);
      expect(smokeJson.httpBridgeRememberOk).toBe(true);
      expect(smokeJson.httpBridgeContextIncludesPackageImport).toBe(true);
      expect(smokeJson.httpBridgeItemCount).toBeGreaterThan(0);
      expect(smokeJson.invalidScopeStatus).toBe(400);
      expect(smokeJson.invalidScopeError).toContain("scope.userId");
      expect(smokeJson.frenchPackId).toBe("fr");
      expect(smokeJson.frenchSearchTerms).toContain("mémoire");
      expect(smokeJson.japanesePackId).toBe("ja");
      expect(smokeJson.japaneseSearchTerms).toContain("日本語");
      expect(smokeJson.koreanPackId).toBe("ko");
      expect(smokeJson.koreanSearchTerms).toContain("한국어");
      expect(smokeJson.spanishPackId).toBe("es");
      expect(smokeJson.spanishSearchTerms).toContain("memoria");
      expect(smokeJson.traditionalChinesePackId).toBe("zh-Hant");
      expect(smokeJson.traditionalChineseSearchTerms).toContain("繁體");
      expect(smokeJson.recallHitCount).toBeGreaterThan(0);
      expect(smokeJson.serverFirstResponseText).toContain("Noted.");
      expect(smokeJson.serverRecallApplied).toBe(true);
      expect(smokeJson.serverRememberSucceeded).toBe(true);
      expect(smokeJson.serverSecondResponseText).toContain(
        "The blocker is still prod verification.",
      );
      expect(smokeJson.serverSecondSystem).toContain(
        "blocker is prod verification",
      );
      expect(smokeJson.explicitSqliteRememberError).toContain(
        "GoodMemory built-in SQLite storage is unavailable in this runtime.",
      );
      expect(smokeJson.explicitPostgresRememberError).toContain(
        "GoodMemory built-in Postgres storage is unavailable in this runtime.",
      );
      expect(smokeJson.artifactPaths).toContain("MEMORY.md");
      expect(smokeJson.validatedToolPayloadShape).toBe("object");
      expect(smokeJson.validatedFileEditPath).toBe(
        "playbooks/consumer-checklist.md",
      );
      expect(smokeJson.runtimeInfo).toEqual({
        assistedExtractionEnabled: false,
        embeddingEnabled: false,
        explicitAdaptersConfigured: false,
        explicitStorageConfigured: false,
        storage: {
          mode: "auto",
          primaryProvider: "memory",
          durability: "ephemeral",
          fallbackReason: "runtime_without_local_sqlite",
          postgresConfigured: false,
        },
      });
      expect(smokeJson.explicitSqliteRuntimeInfo).toEqual({
        assistedExtractionEnabled: false,
        embeddingEnabled: false,
        explicitAdaptersConfigured: false,
        explicitStorageConfigured: true,
        storage: {
          mode: "explicit",
          primaryProvider: "sqlite",
          durability: "unavailable",
          postgresConfigured: false,
          sqliteUrl: expect.stringContaining("consumer-node.sqlite"),
          unavailableReason: "runtime_without_builtin_sqlite",
        },
      });
      expect(smokeJson.explicitPostgresRuntimeInfo).toEqual({
        assistedExtractionEnabled: false,
        embeddingEnabled: false,
        explicitAdaptersConfigured: false,
        explicitStorageConfigured: true,
        storage: {
          mode: "explicit",
          primaryProvider: "postgres",
          durability: "unavailable",
          postgresConfigured: true,
          unavailableReason: "runtime_without_builtin_postgres",
        },
      });

      await expect(
        access(join(workspaceRoot, ".goodmemory/memory.sqlite")),
      ).rejects.toThrow();

      const typeSmoke = await runCommand({
        cmd: [
          join(ROOT_PACKAGE_PATH, "node_modules/.bin/tsc"),
          "-p",
          "tsconfig.json",
          "--noEmit",
        ],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(typeSmoke.exitCode).toBe(0);

      const cliHelp = await runCommand({
        cmd: ["./node_modules/.bin/goodmemory", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(cliHelp.exitCode).toBe(0);
      expect(cliHelp.stdout).toContain("GoodMemory CLI");
      expect(cliHelp.stdout).toContain("goodmemory <command> [options]");

      const httpBridgeHelp = await runCommand({
        cmd: ["./node_modules/.bin/goodmemory-http-bridge", "--help"],
        cwd: workspaceRoot,
        env: { ...RELEASE_TEST_ENV },
      });
      expect(httpBridgeHelp.exitCode).toBe(0);
      expect(httpBridgeHelp.stdout).toContain("GoodMemory HTTP memory bridge");
      expect(httpBridgeHelp.stdout).toContain("GOODMEMORY_HTTP_BRIDGE_TOKEN");

      const httpBridgePort = allocateBridgePort();
      const httpBridgeToken = "package-boundary-http-bridge-token";
      const httpBridgeUrl = `http://127.0.0.1:${httpBridgePort}`;
      const httpBridgeProcess = Bun.spawn({
        cmd: [
          "./node_modules/.bin/goodmemory-http-bridge",
          "--host",
          "127.0.0.1",
          "--port",
          String(httpBridgePort),
          "--profile",
          "life-coach",
          "--token",
          httpBridgeToken,
        ],
        cwd: workspaceRoot,
        env: createChildEnv({
          ...RELEASE_TEST_ENV,
          GOODMEMORY_STORAGE_PROVIDER: "memory",
        }),
        stdout: "pipe",
        stderr: "pipe",
      });
      const httpBridgeStdout = new Response(httpBridgeProcess.stdout).text();
      const httpBridgeStderr = new Response(httpBridgeProcess.stderr).text();

      try {
        await waitForInstalledHttpBridgeReady({
          token: httpBridgeToken,
          url: httpBridgeUrl,
        });

        const pythonSmoke = await runCommand({
          cmd: [
            "python3",
            join(ROOT_PACKAGE_PATH, "examples/python-fastapi-memory-consumer.py"),
          ],
          cwd: workspaceRoot,
          env: {
            ...RELEASE_TEST_ENV,
            GOODMEMORY_BRIDGE_TOKEN: httpBridgeToken,
            GOODMEMORY_BRIDGE_URL: httpBridgeUrl,
          },
        });
        expect(pythonSmoke.exitCode).toBe(0);
        expect(pythonSmoke.stderr).toBe("");
        const pythonSmokeJson = extractJsonObject<{
          feedbackAccepted: boolean;
          hasContext: boolean;
          itemCount: number;
          revised: boolean;
        }>(pythonSmoke.stdout);
        expect(pythonSmokeJson.hasContext).toBe(true);
        expect(pythonSmokeJson.itemCount).toBeGreaterThan(0);
        expect(pythonSmokeJson.feedbackAccepted).toBe(true);
        expect(pythonSmokeJson.revised).toBe(true);
      } finally {
        httpBridgeProcess.kill("SIGTERM");
        await httpBridgeProcess.exited;
      }

      const [serverStdout, serverStderr] = await Promise.all([
        httpBridgeStdout,
        httpBridgeStderr,
      ]);
      expect(serverStdout).toContain('"event":"ready"');
      expect(serverStdout).toContain('"auth":"bearer"');
      expect(serverStderr).toBe("");
    } finally {
      await rm(packOutputDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
