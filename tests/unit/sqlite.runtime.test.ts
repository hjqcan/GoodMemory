import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
  applySQLiteCustomLibrary,
  detectBundledSQLiteVssRuntime,
  loadSQLiteVectorExtension,
  probeBundledSQLiteVssRuntime,
  resolveSQLiteCustomLibraryConfig,
  resolveSQLiteRuntimeConfig,
  resolveSQLiteRuntimeResolution,
  resolveSQLiteVectorExtensionConfig,
} from "../../src/storage/sqliteRuntime";

interface ChildProcessResult {
  output: string;
  status: number | null;
}

function createChildEnv(
  overrides: Record<string, string | undefined>,
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
      continue;
    }

    env[key] = value;
  }

  return env;
}

function runFactoryScript(
  source: string,
  envOverrides: Record<string, string | undefined> = {},
): ChildProcessResult {
  const result = spawnSync(process.execPath, ["--env-file=/dev/null", "-e", source], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: createChildEnv(envOverrides),
  });

  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

describe("sqlite runtime config", () => {
  it("defaults vector extension mode to off when no env vars are configured", () => {
    expect(resolveSQLiteRuntimeConfig({})).toEqual({
      customLibraryPath: undefined,
      vectorExtension: {
        backend: "none",
        entryPoint: undefined,
        mode: "off",
        path: undefined,
        paths: [],
        searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
      },
    });
  });

  it("treats an extension path without an explicit mode as prefer", () => {
    expect(
      resolveSQLiteRuntimeConfig({
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: "/opt/sqlite/vector.dylib",
      }),
    ).toEqual({
      customLibraryPath: undefined,
      vectorExtension: {
        backend: "sql-function",
        entryPoint: undefined,
        mode: "prefer",
        path: "/opt/sqlite/vector.dylib",
        paths: ["/opt/sqlite/vector.dylib"],
        searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
      },
    });
  });

  it("supports comma-separated extension load paths", () => {
    expect(
      resolveSQLiteRuntimeConfig({
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH:
          "/opt/sqlite/vector0.dylib, /opt/sqlite/vss0.dylib",
      }),
    ).toEqual({
      customLibraryPath: undefined,
      vectorExtension: {
        backend: "sql-function",
        entryPoint: undefined,
        mode: "prefer",
        path: "/opt/sqlite/vector0.dylib, /opt/sqlite/vss0.dylib",
        paths: [
          "/opt/sqlite/vector0.dylib",
          "/opt/sqlite/vss0.dylib",
        ],
        searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
      },
    });
  });

  it("resolves custom library and vector extension config helpers from env", () => {
    expect(
      resolveSQLiteCustomLibraryConfig({
        GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH: " /opt/sqlite/libsqlite3.dylib ",
      }),
    ).toEqual({
      customLibraryPath: "/opt/sqlite/libsqlite3.dylib",
    });
    expect(
      resolveSQLiteVectorExtensionConfig({
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT: "sqlite3_vector_init",
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH:
          "/opt/sqlite/vector0.dylib,/opt/sqlite/vss0.dylib",
        GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: "vss_cosine_similarity",
      }),
    ).toEqual({
      backend: "sql-function",
      entryPoint: "sqlite3_vector_init",
      mode: "prefer",
      path: "/opt/sqlite/vector0.dylib,/opt/sqlite/vss0.dylib",
      paths: ["/opt/sqlite/vector0.dylib", "/opt/sqlite/vss0.dylib"],
      searchFunction: "vss_cosine_similarity",
    });
  });

  it("rejects invalid vector extension modes", () => {
    expect(() =>
      resolveSQLiteRuntimeConfig({
        GOODMEMORY_SQLITE_VECTOR_MODE: "invalid",
      }),
    ).toThrow("Unsupported GOODMEMORY_SQLITE_VECTOR_MODE");
  });

  it("rejects invalid vector search function identifiers", () => {
    expect(() =>
      resolveSQLiteRuntimeConfig({
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: "/opt/sqlite/vector0.dylib",
        GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: "vss-inner-product",
      }),
    ).toThrow("Unsupported GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION");
  });

  it("requires an extension path when vector mode is prefer or require", () => {
    expect(() =>
      resolveSQLiteRuntimeConfig({
        GOODMEMORY_SQLITE_VECTOR_MODE: "require",
      }),
    ).toThrow("GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH is required");
  });

  it("auto-detects the canonical sqlite-vss runtime when manual env paths are absent", () => {
    const resolution = resolveSQLiteRuntimeResolution(
      {},
      {
        detectBundledSQLiteVssRuntime: () => ({
          customLibraryPath: "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
          paths: [
            "/opt/sqlite/vector0.dylib",
            "/opt/sqlite/vss0.dylib",
          ],
        }),
      },
    );

    expect(resolution).toMatchObject({
      config: {
        customLibraryPath: "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
        vectorExtension: {
          backend: "sqlite-vss",
          mode: "prefer",
          path: "/opt/sqlite/vector0.dylib,/opt/sqlite/vss0.dylib",
          paths: [
            "/opt/sqlite/vector0.dylib",
            "/opt/sqlite/vss0.dylib",
          ],
        },
      },
      diagnostics: {
        available: true,
        backend: "sqlite-vss",
        source: "bundled-sqlite-vss",
      },
    });
  });

  it("keeps acceleration disabled when vector mode is explicitly off even if the canonical runtime is available", () => {
    const resolution = resolveSQLiteRuntimeResolution(
      {
        GOODMEMORY_SQLITE_VECTOR_MODE: "off",
      },
      {
        detectBundledSQLiteVssRuntime: () => ({
          customLibraryPath: "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
          paths: [
            "/opt/sqlite/vector0.dylib",
            "/opt/sqlite/vss0.dylib",
          ],
        }),
      },
    );

    expect(resolution).toMatchObject({
      config: {
        customLibraryPath: undefined,
        vectorExtension: {
          backend: "none",
          mode: "off",
          path: undefined,
          paths: [],
        },
      },
      diagnostics: {
        available: true,
        backend: "none",
        source: "disabled",
      },
    });
  });

  it("keeps explicit extension paths authoritative over bundled sqlite-vss detection", () => {
    const resolution = resolveSQLiteRuntimeResolution(
      {
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: "/opt/sqlite/manual-vss0.dylib",
      },
      {
        detectBundledSQLiteVssRuntime: () => ({
          customLibraryPath: "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
          paths: [
            "/opt/sqlite/vector0.dylib",
            "/opt/sqlite/vss0.dylib",
          ],
        }),
      },
    );

    expect(resolution).toMatchObject({
      config: {
        customLibraryPath: undefined,
        vectorExtension: {
          backend: "sql-function",
          mode: "prefer",
          path: "/opt/sqlite/manual-vss0.dylib",
          paths: ["/opt/sqlite/manual-vss0.dylib"],
        },
      },
      diagnostics: {
        backend: "sql-function",
        source: "env",
      },
    });
  });

  it("reports acceleration as unavailable when require mode is requested and no canonical runtime is detected", () => {
    const resolution = resolveSQLiteRuntimeResolution(
      {
        GOODMEMORY_SQLITE_VECTOR_MODE: "require",
      },
      {
        detectBundledSQLiteVssRuntime: () => null,
      },
    );

    expect(resolution).toMatchObject({
      config: {
        vectorExtension: {
          backend: "none",
          mode: "off",
        },
      },
      diagnostics: {
        available: false,
        backend: "none",
        requestedMode: "require",
        source: "unavailable",
      },
    });
  });

  it("reports bundled sqlite-vss probe failures as unavailable in implicit auto mode", () => {
    const resolution = resolveSQLiteRuntimeResolution(
      {},
      {
        inspectBundledSQLiteVssRuntime: () => ({
          runtime: null,
          unavailableReason: "missing libgomp",
        }),
      },
    );

    expect(resolution).toMatchObject({
      config: {
        vectorExtension: {
          backend: "none",
          mode: "off",
        },
      },
      diagnostics: {
        available: false,
        backend: "none",
        requestedMode: "prefer",
        source: "unavailable",
        reason: "missing libgomp",
      },
    });
  });
});

describe("sqlite runtime hooks", () => {
  it("detects the bundled sqlite-vss runtime on supported machines when the assets are present", () => {
    const runtime = detectBundledSQLiteVssRuntime();

    if (!runtime) {
      expect(runtime).toBeNull();
      return;
    }

    expect(runtime.customLibraryPath).toContain("sqlite");
    expect(runtime.paths).toHaveLength(2);
    expect(runtime.paths[0]).toContain("vector0");
    expect(runtime.paths[1]).toContain("vss0");
  });

  it("does not mark bundled sqlite-vss as available when the runtime probe fails", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: () => true,
      getVectorLoadablePath: () => "/tmp/vector0.so",
      getVssLoadablePath: () => "/tmp/vss0.so",
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: false,
        reason: "missing libgomp",
      }),
    });

    expect(runtime).toBeNull();
  });

  it("detects bundled sqlite-vss only after the runtime probe succeeds", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: () => true,
      getVectorLoadablePath: () => "/tmp/vector0.so",
      getVssLoadablePath: () => "/tmp/vss0.so",
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: true,
      }),
    });

    expect(runtime).toEqual({
      customLibraryPath: "/tmp/libsqlite3.so",
      paths: ["/tmp/vector0.so", "/tmp/vss0.so"],
    });
  });

  it("does not detect bundled sqlite-vss without a usable sqlite library path", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: () => false,
      getVectorLoadablePath: () => "/tmp/vector0.so",
      getVssLoadablePath: () => "/tmp/vss0.so",
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: true,
      }),
    });

    expect(runtime).toBeNull();
  });

  it("does not detect bundled sqlite-vss without module path accessors", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: () => true,
      getVectorLoadablePath: undefined,
      getVssLoadablePath: undefined,
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: true,
      }),
    });

    expect(runtime).toBeNull();
  });

  it("does not detect bundled sqlite-vss when loadable assets are missing", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: (path) => path === "/tmp/libsqlite3.so",
      getVectorLoadablePath: () => "/tmp/vector0.so",
      getVssLoadablePath: () => "/tmp/vss0.so",
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: true,
      }),
    });

    expect(runtime).toBeNull();
  });

  it("does not detect bundled sqlite-vss when path discovery throws", () => {
    const runtime = detectBundledSQLiteVssRuntime({
      exists: () => true,
      getVectorLoadablePath: () => {
        throw new Error("broken package");
      },
      getVssLoadablePath: () => "/tmp/vss0.so",
      libraryCandidatePaths: ["/tmp/libsqlite3.so"],
      probeRuntime: () => ({
        loadable: true,
      }),
    });

    expect(runtime).toBeNull();
  });

  it("passes all runtime paths into the sqlite-vss probe subprocess", () => {
    const result = probeBundledSQLiteVssRuntime({
      customLibraryPath: "/tmp/goodmemory-missing-sqlite",
      paths: ["/tmp/goodmemory-missing-vector0", "/tmp/goodmemory-missing-vss0"],
    });

    expect(result.loadable).toBeFalse();
    expect(result.reason).toContain("/tmp/goodmemory-missing-");
  });

  it("keeps vector bootstrap out of document and session store factories", () => {
    const result = runFactoryScript(
      `
        import {
          createSQLiteDocumentStore,
          createSQLiteSessionStore,
        } from "./src/storage/sqlite";

        try {
          createSQLiteDocumentStore(":memory:");
          createSQLiteSessionStore(":memory:");
          console.log("ok");
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      `,
      {
        GOODMEMORY_SQLITE_VECTOR_MODE: "require",
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
      },
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("ok");
  });

  it("uses a real sqlite-vss virtual table on supported runtimes when manual env paths are absent", () => {
    const result = runFactoryScript(
      `
        import { Database } from "bun:sqlite";
        import { mkdtempSync } from "node:fs";
        import { tmpdir } from "node:os";
        import { join } from "node:path";
        import { createSQLiteVectorStore } from "./src/storage/sqlite";

        const root = mkdtempSync(join(tmpdir(), "goodmemory-phase28-"));
        const path = join(root, "memory.sqlite");
        const store = createSQLiteVectorStore(path);
        await store.upsert("facts", [
          {
            id: "fact-1",
            embedding: [0, 1, 0],
            metadata: { userId: "u-1" },
            content: "first",
          },
          {
            id: "fact-2",
            embedding: [1, 0, 0],
            metadata: { userId: "u-1" },
            content: "second",
          },
        ]);
        const results = await store.search("facts", [1, 0, 0], {
          topK: 1,
          filter: { userId: "u-1" },
        });
        const db = new Database(path, { strict: true });
        const table = db.query(
          "select name from sqlite_master where type = 'table' and name = 'vss_vectors_facts_dim_3'",
        ).get();
        console.log(JSON.stringify({
          accelerated: Boolean(table),
          resultId: results[0]?.id ?? null,
        }));
      `,
      {
        GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH: undefined,
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT: undefined,
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
        GOODMEMORY_SQLITE_VECTOR_MODE: undefined,
        GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION: undefined,
      },
    );

    if (!detectBundledSQLiteVssRuntime()) {
      expect(result.status).toBe(0);
      expect(result.output).toContain('"accelerated":false');
      expect(result.output).toContain('"resultId":"fact-2"');
      return;
    }

    expect(result.status).toBe(0);
    expect(result.output).toContain('"accelerated":true');
    expect(result.output).toContain('"resultId":"fact-2"');
  });

  it("uses the canonical sqlite-vss runtime through the public vector store factory when require mode is set on supported machines", () => {
    const result = runFactoryScript(
      `
        import { createSQLiteVectorStore } from "./src/storage/sqlite";

        try {
          createSQLiteVectorStore(":memory:");
          console.log("ok");
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      `,
      {
        GOODMEMORY_SQLITE_VECTOR_MODE: "require",
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
      },
    );

    if (detectBundledSQLiteVssRuntime()) {
      expect(result.status).toBe(0);
      expect(result.output).toContain("ok");
      return;
    }

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "SQLite vector acceleration was requested",
    );
  });

  it("applies a custom sqlite library before the first database is opened", () => {
    const result = runFactoryScript(
      `
        import { createSQLiteDocumentStore } from "./src/storage/sqlite";

        try {
          createSQLiteDocumentStore(":memory:");
          console.log("ok");
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      `,
      {
        GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH: "/tmp/does-not-exist.dylib",
        GOODMEMORY_SQLITE_VECTOR_MODE: undefined,
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH: undefined,
        GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT: undefined,
      },
    );

    if (process.platform === "darwin") {
      expect(result.status).toBe(1);
      expect(result.output).toContain("dlopen(");
      expect(result.output).not.toContain("SQLite already loaded");
      return;
    }

    expect(result.status).toBe(0);
    expect(result.output).toContain("ok");
  });

  it("applies a custom sqlite library path when configured", () => {
    const calls: string[] = [];
    const controller = {
      setCustomSQLite(path: string) {
        calls.push(path);
        return true;
      },
    };

    applySQLiteCustomLibrary(
      {
        customLibraryPath: "/opt/homebrew/lib/libsqlite3.dylib",
      },
      controller,
    );
    applySQLiteCustomLibrary(
      {
        customLibraryPath: "/opt/homebrew/lib/libsqlite3.dylib",
      },
      controller,
    );

    expect(calls).toEqual(["/opt/homebrew/lib/libsqlite3.dylib"]);
  });

  it("rejects a second custom sqlite library for the same runtime", () => {
    const controller = {
      setCustomSQLite() {
        return true;
      },
    };

    applySQLiteCustomLibrary(
      {
        customLibraryPath: "/opt/homebrew/lib/libsqlite3.dylib",
      },
      controller,
    );

    expect(() =>
      applySQLiteCustomLibrary(
        {
          customLibraryPath: "/usr/local/lib/libsqlite3.dylib",
        },
        controller,
      ),
    ).toThrow(
      "SQLite runtime already uses /opt/homebrew/lib/libsqlite3.dylib and cannot switch to /usr/local/lib/libsqlite3.dylib.",
    );
  });

  it("does not apply a custom sqlite library when no path is configured", () => {
    const calls: string[] = [];

    applySQLiteCustomLibrary(
      {},
      {
        setCustomSQLite(path: string) {
          calls.push(path);
          return true;
        },
      },
    );

    expect(calls).toEqual([]);
  });

  it("reports vector extension loading as disabled when mode is off", () => {
    const calls: string[] = [];
    const result = loadSQLiteVectorExtension(
      {
        backend: "none",
        mode: "off",
        paths: [],
        searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
      },
      {
        loadExtension(path: string) {
          calls.push(path);
        },
      },
    );

    expect(result.loaded).toBeFalse();
    expect(result.reason).toContain("disabled");
    expect(calls).toEqual([]);
  });

  it("swallows vector extension load failures in prefer mode", () => {
    const calls: Array<{ entryPoint?: string; path: string }> = [];

    expect(() =>
      loadSQLiteVectorExtension(
        {
          backend: "sql-function",
          mode: "prefer",
          path: "/opt/sqlite/vector.dylib",
          paths: ["/opt/sqlite/vector.dylib"],
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
        {
          loadExtension(path: string, entryPoint?: string) {
            calls.push({ path, entryPoint });
            throw new Error("missing binary");
          },
        },
      ),
    ).not.toThrow();
    expect(calls).toEqual([
        {
          path: "/opt/sqlite/vector.dylib",
        },
      ]);
  });

  it("loads multiple extensions in order when configured", () => {
    const calls: Array<{ entryPoint?: string; path: string }> = [];

    loadSQLiteVectorExtension(
      {
        backend: "sql-function",
        mode: "prefer",
        path: "/opt/sqlite/vector0.dylib, /opt/sqlite/vss0.dylib",
        paths: [
          "/opt/sqlite/vector0.dylib",
          "/opt/sqlite/vss0.dylib",
        ],
        searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
      },
      {
        loadExtension(path: string, entryPoint?: string) {
          calls.push({ path, entryPoint });
        },
      },
    );

    expect(calls).toEqual([
      { path: "/opt/sqlite/vector0.dylib", entryPoint: undefined },
      { path: "/opt/sqlite/vss0.dylib", entryPoint: undefined },
    ]);
  });

  it("throws a descriptive error when vector extension load fails in require mode", () => {
    expect(() =>
      loadSQLiteVectorExtension(
        {
          backend: "sql-function",
          mode: "require",
          path: "/opt/sqlite/vector.dylib",
          paths: ["/opt/sqlite/vector.dylib"],
          entryPoint: "sqlite3_vector_init",
          searchFunction: DEFAULT_SQLITE_VECTOR_SEARCH_FUNCTION,
        },
        {
          loadExtension() {
            throw new Error("missing binary");
          },
        },
      ),
    ).toThrow("Failed to load SQLite vector extension");
  });
});
