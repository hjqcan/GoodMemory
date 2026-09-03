import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFrozenPrehistoryArmPlans } from "../../scripts/codex-coding-effect/c3-arms";
import { collectC3HostConfigurationEvidence } from "../../scripts/codex-coding-effect/c3-host-configuration";
import {
  auditC3PermissionIsolation,
  preflightC3InstalledRecall,
  prepareC3InstalledArm,
  prepareC3NoMemoryArm,
  seedC3InstalledArm,
} from "../../scripts/codex-coding-effect/c3-runtime";
import { loadFrozenPrehistory, sealFrozenPrehistory } from "../../scripts/codex-coding-effect/frozen-prehistory";
import { buildNativeCanarySessionDigest } from "../../scripts/codex-coding-effect/native-canary-contracts";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "../../scripts/codex-coding-effect/process";

describe("Codex coding-effect C3 installed runtime", () => {
  it("copies a runner-owned npm cache seed into the arm cache and installs offline", async () => {
    await withRuntimeFixture(async (fixture) => {
      const seed = join(fixture.root, "npm-cache-seed");
      await mkdir(join(seed, "_cacache", "index-v5"), { recursive: true });
      await writeFile(
        join(seed, "_cacache", "index-v5", "entry"),
        "seeded\n",
        "utf8",
      );
      const calls: string[][] = [];
      const runProcess = createFakeBoundary(fixture, calls);
      const installed = await prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmCacheSeed: seed,
        npmExecutable: fixture.npmExecutable,
        npmRegistry: "https://registry.example.test",
        packageTarball: fixture.packageTarball,
        plan: fixture.plans[1],
        runProcess,
      });

      expect(await readFile(
        join(installed.plan.paths.cache, "_cacache", "index-v5", "entry"),
        "utf8",
      )).toBe("seeded\n");
      expect(installed.env.npm_config_cache).toBe(installed.plan.paths.cache);
      expect(calls).toContainEqual([
        "install",
        "--global",
        "--prefix",
        fixture.plans[1].paths.packagePrefix!,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--offline",
        "--registry",
        "https://registry.example.test",
        fixture.packageTarball,
      ]);
      expect(calls.some((args) => args.includes("--fetch-timeout"))).toBe(false);

      await expect(prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmCacheSeed: fixture.packageTarball,
        npmExecutable: fixture.npmExecutable,
        packageTarball: fixture.packageTarball,
        plan: fixture.plans[1],
        runProcess,
      })).rejects.toThrow(/npm cache seed must be a real directory|already exists/u);
    });
  });

  it("installs only the tarball, activates recommended global profile, and leaves repo instructions unchanged", async () => {
    await withRuntimeFixture(async (fixture) => {
      const calls: string[][] = [];
      const runProcess = createFakeBoundary(fixture, calls);
      const installed = await prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmExecutable: fixture.npmExecutable,
        packageTarball: fixture.packageTarball,
        plan: fixture.plans[1],
        runProcess,
      });
      const noMemory = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        plan: fixture.plans[0],
        runProcess,
      });

      expect(installed.profile).toEqual({
        activationMode: "global",
        hookRegistered: true,
        mcpRegistered: true,
        persistRawTranscript: false,
        retrievalProfile: "coding_agent",
        workspaceStatus: "ok",
        writebackMode: "selective",
      });
      expect(installed.package.sha256).toBe(
        createHash("sha256").update("fake tarball\n").digest("hex"),
      );
      expect(installed.package.version).toBe("0.5.1");
      expect(installed.preexistingSessionCount).toBe(0);
      expect(installed.permissionProfile).toMatchObject({
        filesystemDefault: "deny",
        minimalRead: true,
        name: "c3-task",
        networkAccess: false,
        workspaceWrite: true,
      });
      expect(await readFile(
        join(fixture.plans[1].paths.codexHome, "config.toml"),
        "utf8",
      )).toContain('[permissions.c3-task.filesystem.":workspace_roots"]');
      expect(await readFile(
        join(fixture.plans[1].paths.workspace, "AGENTS.md"),
        "utf8",
      )).toBe("# Shared task instructions\n");
      expect(await Bun.file(
        join(fixture.plans[1].paths.workspace, ".goodmemory", "codex.json"),
      ).exists()).toBe(false);
      expect(calls).toContainEqual([
        "install",
        "--global",
        "--prefix",
        fixture.plans[1].paths.packagePrefix!,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--fetch-retries",
        "5",
        "--fetch-timeout",
        "60000",
        fixture.packageTarball,
      ]);
      expect(calls).toContainEqual([
        "setup",
        "--recommended",
        "--host",
        "codex",
        "--user-id",
        fixture.plans[1].scopes.userId,
        "--yes",
        "--json",
      ]);
      expect(calls.some((args) => args.includes("enable"))).toBe(false);
      expect(calls).toContainEqual([
        "--disable",
        "memories",
        "features",
        "list",
      ]);
      const hostConfigurations = await collectC3HostConfigurationEvidence({
        installedRuntime: installed,
        noMemoryRuntime: noMemory,
      });
      expect(hostConfigurations.normalizedDiff.map((entry) => entry.path)).toEqual(
        expect.arrayContaining([
          "codexConfig.normalizedText",
          "goodmemoryConfig.normalizedText",
          "hooksConfig.normalizedText",
        ]),
      );
      expect(
        hostConfigurations.arms.goodmemoryInstalled.goodmemoryConfig?.normalizedText,
      ).toContain('"userId": "<user-id>"');
      expect(
        hostConfigurations.arms.goodmemoryInstalled.goodmemoryConfig?.normalizedText,
      ).not.toContain(fixture.root);
      expect(
        hostConfigurations.arms.goodmemoryInstalled.environment.PATH,
      ).toContain("<package-prefix>/bin");
      expect(
        hostConfigurations.arms.goodmemoryInstalled.environment.PATH,
      ).toContain("<host-path>");
      expect(
        hostConfigurations.arms.goodmemoryInstalled.environment.PATH,
      ).not.toContain("/Users/");
    });
  });

  it("normalizes the other arm's roots and the source repository in denied-path configuration", async () => {
    await withRuntimeFixture(async (fixture) => {
      const calls: string[][] = [];
      const runProcess = createFakeBoundary(fixture, calls);
      const repositoryRoot = join(fixture.root, "source", "repositories", "policy-utils");
      await mkdir(repositoryRoot, { recursive: true });
      const installed = await prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmExecutable: fixture.npmExecutable,
        packageTarball: fixture.packageTarball,
        permissionDeniedReadPaths: [
          fixture.plans[0].paths.armRoot,
          fixture.plans[0].paths.workspace,
          repositoryRoot,
        ],
        plan: fixture.plans[1],
        runProcess,
      });
      const noMemory = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        permissionDeniedReadPaths: [
          fixture.plans[1].paths.armRoot,
          fixture.plans[1].paths.workspace,
          repositoryRoot,
        ],
        plan: fixture.plans[0],
        runProcess,
      });
      const hostConfigurations = await collectC3HostConfigurationEvidence({
        installedRuntime: installed,
        noMemoryRuntime: noMemory,
        repositoryRoot,
      });
      for (const arm of [
        hostConfigurations.arms.goodmemoryInstalled,
        hostConfigurations.arms.noMemory,
      ]) {
        const normalized = arm.codexConfig.normalizedText;
        expect(normalized).toContain('"<other-arm-root>" = "deny"');
        expect(normalized).toContain('"<other-workspace>" = "deny"');
        expect(normalized).toContain('"<source-repository>" = "deny"');
        expect(normalized).not.toContain(fixture.root);
        // Caller (category) order survives; a lexicographic sort of the raw
        // paths would have placed the repository before the workspace.
        const order = [
          '"<other-arm-root>" = "deny"',
          '"<other-workspace>" = "deny"',
          '"<source-repository>" = "deny"',
        ].map((line) => normalized.indexOf(line));
        expect(order[0]).toBeLessThan(order[1]!);
        expect(order[1]).toBeLessThan(order[2]!);
      }
    });
  });

  it("keeps the no-memory environment empty and omits the packaged prefix", async () => {
    await withRuntimeFixture(async (fixture) => {
      const calls: string[][] = [];
      const sensitivePath = join(fixture.root, "frozen-evaluator.ts");
      await writeFile(sensitivePath, "hidden evaluator bytes\n", "utf8");
      const noMemory = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        permissionDeniedReadPaths: [sensitivePath],
        plan: fixture.plans[0],
        runProcess: createFakeBoundary(fixture, calls),
      });

      expect(noMemory.isolation.passed).toBe(true);
      expect(noMemory.isolation.codexHomeEntryNames).toEqual([
        "auth.json",
        "config.toml",
      ]);
      expect(noMemory.permissionProfile).toMatchObject({
        filesystemDefault: "deny",
        minimalRead: true,
        name: "c3-task",
        networkAccess: false,
        workspaceWrite: true,
      });
      const config = await readFile(
        join(fixture.plans[0].paths.codexHome, "config.toml"),
        "utf8",
      );
      expect(config).toContain('default_permissions = "c3-task"');
      expect(config).toContain('":root" = "deny"');
      expect(config).toContain('":minimal" = "read"');
      expect(config).toContain(`${JSON.stringify(sensitivePath)} = "deny"`);
      expect(config).toContain("enabled = false");
      expect(noMemory.env.GOODMEMORY_HOME).toBeUndefined();
      expect(noMemory.env.PATH).not.toContain(
        fixture.plans[1].paths.packagePrefix!,
      );
      expect(calls.some((args) => args[0] === "install")).toBe(false);
    });
  });

  it("rejects indented and nested legacy sandbox configuration", async () => {
    await withRuntimeFixture(async (fixture) => {
      for (const legacyConfig of [
        "[features]\nhooks = true\n  sandbox_mode = \"workspace-write\"\n",
        "[features]\nhooks = true\n[sandbox_workspace_write.network]\nenabled = false\n",
      ]) {
        await expect(prepareC3InstalledArm({
          authFile: fixture.authFile,
          bunExecutable: process.execPath,
          codexExecutable: fixture.codexExecutable,
          npmExecutable: fixture.npmExecutable,
          packageTarball: fixture.packageTarball,
          plan: fixture.plans[1],
          runProcess: createFakeBoundary(fixture, [], legacyConfig),
        })).rejects.toThrow(
          "isolated Codex config contains legacy sandbox settings",
        );
        await rm(fixture.plans[1].paths.armRoot, {
          force: true,
          recursive: true,
        });
      }
    });
  });

  it("probes workspace access and fails closed on external reads", async () => {
    await withRuntimeFixture(async (fixture) => {
      const runtime = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        plan: fixture.plans[0],
        runProcess: createFakeBoundary(fixture, []),
      });
      const sensitivePath = join(fixture.root, "evaluator-secret.ts");
      await writeFile(sensitivePath, "hidden evaluator bytes\n", "utf8");
      const evidence = await auditC3PermissionIsolation({
        deniedReadPaths: [{ label: "evaluator", path: sensitivePath }],
        networkProbe: async () => ({
          networkDenied: true,
          networkPositiveControl: true,
        }),
        phase: "preflight",
        runProcess: async (request) => {
          const commandIndex = request.args.indexOf("--") + 1;
          const command = request.args[commandIndex];
          const path = request.args[commandIndex + 1]!;
          if (command === "/usr/bin/touch") {
            await writeFile(path, "", "utf8");
            return processResult();
          }
          if (path === sensitivePath) {
            return processResult({ exitCode: 77, stderr: "Operation not permitted" });
          }
          return processResult({ stdout: await readFile(path, "utf8") });
        },
        runtime,
      });

      expect(evidence.audit).toMatchObject({
        deniedReads: [{ denied: true, label: "evaluator" }],
        networkAccess: false,
        networkDenied: true,
        networkPositiveControl: true,
        passed: true,
        phase: "preflight",
        profileName: "c3-task",
        workspaceRead: true,
        workspaceWrite: true,
      });
      expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.parse(await readFile(
        join(runtime.plan.paths.result, "permission-isolation-preflight.json"),
        "utf8",
      )) as unknown).toEqual(evidence.audit);
    });
  });

  it("fails permission isolation when the active task profile reaches loopback", async () => {
    await withRuntimeFixture(async (fixture) => {
      const runtime = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        plan: fixture.plans[0],
        runProcess: createFakeBoundary(fixture, []),
      });
      const sensitivePath = join(fixture.root, "network-probe-secret.ts");
      await writeFile(sensitivePath, "hidden evaluator bytes\n", "utf8");

      await expect(auditC3PermissionIsolation({
        deniedReadPaths: [{ label: "evaluator", path: sensitivePath }],
        networkProbe: async () => ({
          networkDenied: false,
          networkPositiveControl: true,
        }),
        phase: "preflight",
        runProcess: async (request) => {
          const commandIndex = request.args.indexOf("--") + 1;
          const command = request.args[commandIndex];
          const path = request.args[commandIndex + 1]!;
          if (command === "/usr/bin/touch") {
            await writeFile(path, "", "utf8");
            return processResult();
          }
          if (path === sensitivePath) {
            return processResult({
              exitCode: 77,
              stderr: "Operation not permitted",
            });
          }
          return processResult({ stdout: await readFile(path, "utf8") });
        },
        runtime,
      })).rejects.toThrow(
        "permission profile allowed loopback network access",
      );
    });
  });

  it("fails permission isolation when a probe mutates the active config", async () => {
    await withRuntimeFixture(async (fixture) => {
      const runtime = await prepareC3NoMemoryArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        plan: fixture.plans[0],
        runProcess: createFakeBoundary(fixture, []),
      });
      const sensitivePath = join(fixture.root, "config-drift-secret.ts");
      await writeFile(sensitivePath, "hidden evaluator bytes\n", "utf8");

      await expect(auditC3PermissionIsolation({
        deniedReadPaths: [{ label: "evaluator", path: sensitivePath }],
        networkProbe: async () => ({
          networkDenied: true,
          networkPositiveControl: true,
        }),
        phase: "pre-launch",
        runProcess: async (request) => {
          const commandIndex = request.args.indexOf("--") + 1;
          const command = request.args[commandIndex];
          const path = request.args[commandIndex + 1]!;
          if (command === "/usr/bin/touch") {
            await writeFile(path, "", "utf8");
            return processResult();
          }
          if (path === sensitivePath) {
            await writeFile(
              join(runtime.plan.paths.codexHome, "config.toml"),
              "model = \"drifted\"\n",
              "utf8",
            );
            return processResult({
              exitCode: 77,
              stderr: "Operation not permitted",
            });
          }
          return processResult({ stdout: await readFile(path, "utf8") });
        },
        runtime,
      })).rejects.toThrow(
        "permission profile config changed during isolation audit",
      );
    });
  });

  it("seeds through explicit rollout writeback, exports the store, and persists a receipt", async () => {
    await withRuntimeFixture(async (fixture) => {
      const calls: string[][] = [];
      const runProcess = createFakeBoundary(fixture, calls);
      const installed = await prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmExecutable: fixture.npmExecutable,
        packageTarball: fixture.packageTarball,
        plan: fixture.plans[1],
        runProcess,
      });
      const sourcePath = join(fixture.root, "prehistory.jsonl");
      const sourceBytes = `${rolloutLine(
        "user",
        "Remember that c3 transport inputs are trimmed before validation.",
      )}\n`;
      await writeFile(sourcePath, sourceBytes, "utf8");
      const source = await loadFrozenPrehistory({
        expectedSha256: sha256(sourceBytes),
        path: sourcePath,
      });
      const sealed = await sealFrozenPrehistory({
        artifact: source,
        sealedPath: join(
          fixture.root,
          "sealed",
          "rollout-2026-07-15T00-00-00-11111111-1111-1111-1111-111111111111.jsonl",
        ),
      });
      const receiptPath = join(fixture.root, "seed-receipt.json");

      const result = await seedC3InstalledArm({
        artifact: sealed,
        declaredForbiddenSourceSha256: [],
        forbiddenSources: [],
        forbiddenStrings: ["gold-only-sentinel"],
        receiptPath,
        runProcess,
        runtime: installed,
      });

      expect(result.receipt).toMatchObject({
        historySourceSha256: sealed.sourceSha256,
        rawTranscriptPersisted: false,
        seedSurface: "codex-writeback-from-rollout",
        sourceSessionDigest:
          "session:bafde89c041e1756082b933a",
        writebackOutcome: "written",
        writtenMemoryIds: ["memory-seeded-001"],
      });
      expect(result.exportLeakageAudit.passed).toBe(true);
      expect(JSON.parse(await readFile(receiptPath, "utf8")) as unknown)
        .toEqual(result.receipt);
      const writebackCall = calls.find((args) =>
        args[0] === "codex" && args[1] === "writeback" &&
        args.includes("--from-rollout")
      );
      expect(writebackCall).toContain("--rollout-path");
      expect(writebackCall).toContain(sealed.path);
      expect(writebackCall).toContain(fixture.plans[1].paths.workspace);
      expect(calls.some((args) => args[0] === "remember")).toBe(false);

      const recallPreflight = await preflightC3InstalledRecall({
        prompt: "Improve parseTransportMode for realistic configuration input.",
        runProcess,
        runtime: installed,
        seed: result,
      });
      expect(recallPreflight).toMatchObject({
        expectedMemoryIds: ["memory-seeded-001"],
        injectedMemoryIds: ["memory-seeded-001"],
        passed: true,
      });
      expect(recallPreflight.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(recallPreflight.stateSha256).toMatch(/^[a-f0-9]{64}$/u);
      const sourceProjectionPath = join(
        installed.plan.paths.result,
        "recall-preflight-source.sanitized.json",
      );
      const sourceProjectionRaw = await readFile(sourceProjectionPath, "utf8");
      expect(recallPreflight.sourceProjectionSha256).toBe(
        sha256(sourceProjectionRaw),
      );
      expect(JSON.parse(sourceProjectionRaw) as unknown).toMatchObject({
        hookOutput: {
          additionalContextLength:
            "Developer memory notes: parseTransportMode".length,
          hookEventName: "UserPromptSubmit",
        },
        injectionEvents: [{
          decision: "injected",
          recordIds: ["memory-seeded-001"],
          sessionDigest: buildNativeCanarySessionDigest(
            `${installed.plan.scopes.sessionId}-recall-preflight`,
          ),
        }],
        schemaVersion: 1,
        sessionDigest: buildNativeCanarySessionDigest(
          `${installed.plan.scopes.sessionId}-recall-preflight`,
        ),
      });
      expect(sourceProjectionRaw).not.toContain(
        "Developer memory notes: parseTransportMode",
      );

      await Promise.all([
        rm(join(installed.plan.paths.result, "recall-preflight.json")),
        rm(sourceProjectionPath),
      ]);
      const staleSessionPreflight = await preflightC3InstalledRecall({
        prompt: "Improve parseTransportMode for realistic configuration input.",
        runProcess: async (request) => {
          await writeFile(
            join(
              request.env?.GOODMEMORY_HOME!,
              ".goodmemory",
              "codex-injection-state.json",
            ),
            `${JSON.stringify({
              events: [{
                command: "user-prompt-submit",
                decision: "injected",
                recordIds: ["memory-seeded-001"],
                sessionDigest: "session:stale-preflight",
              }],
              version: 1,
            })}\n`,
            "utf8",
          );
          return processResult({ stdout: `${JSON.stringify({
            hookSpecificOutput: {
              additionalContext: "Developer memory notes: parseTransportMode",
              hookEventName: "UserPromptSubmit",
            },
          })}\n` });
        },
        runtime: installed,
        seed: result,
      });
      expect(staleSessionPreflight).toMatchObject({
        injectedMemoryIds: [],
        passed: false,
        reason: "frozen prehistory is not retrievable before Codex execution",
      });

      await Promise.all([
        rm(join(installed.plan.paths.result, "recall-preflight.json")),
        rm(sourceProjectionPath),
      ]);
      const emptyHookPreflight = await preflightC3InstalledRecall({
        prompt: "Improve parseTransportMode for realistic configuration input.",
        runProcess: async (request) => {
          const hookInput = JSON.parse(String(request.stdin)) as {
            session_id: string;
          };
          await writeFile(
            join(
              request.env?.GOODMEMORY_HOME!,
              ".goodmemory",
              "codex-injection-state.json",
            ),
            `${JSON.stringify({
              events: [{
                command: "user-prompt-submit",
                decision: "injected",
                recordIds: ["memory-seeded-001"],
                sessionDigest: buildNativeCanarySessionDigest(
                  hookInput.session_id,
                ),
              }],
              version: 1,
            })}\n`,
            "utf8",
          );
          return processResult({ stdout: "{}\n" });
        },
        runtime: installed,
        seed: result,
      });
      expect(emptyHookPreflight).toMatchObject({
        injectedMemoryIds: [],
        passed: false,
      });
      if (emptyHookPreflight.passed) {
        throw new Error("empty hook output unexpectedly passed recall preflight");
      }
      expect(emptyHookPreflight.reason).toContain(
        "C3 recall preflight output failed schema validation",
      );

      await Promise.all([
        rm(join(installed.plan.paths.result, "recall-preflight.json")),
        rm(sourceProjectionPath),
      ]);
      const failedPreflight = await preflightC3InstalledRecall({
        prompt: "Improve parseTransportMode for realistic configuration input.",
        runProcess: async (request) => {
          await writeFile(
            join(
              request.env?.GOODMEMORY_HOME!,
              ".goodmemory",
              "codex-injection-state.json",
            ),
            `${JSON.stringify({
              events: [{
                command: "user-prompt-submit",
                decision: "low_relevance",
                recordIds: [],
                sessionDigest: "session:preflight-empty",
              }],
              version: 1,
            })}\n`,
            "utf8",
          );
          return processResult({
            stdout: `${JSON.stringify({
              hookSpecificOutput: {
                additionalContext: "Developer memory notes: parseTransportMode",
                hookEventName: "UserPromptSubmit",
              },
            })}\n`,
          });
        },
        runtime: installed,
        seed: result,
      });
      expect(failedPreflight).toMatchObject({
        expectedMemoryIds: ["memory-seeded-001"],
        injectedMemoryIds: [],
        passed: false,
        reason: "frozen prehistory is not retrievable before Codex execution",
      });
      expect(JSON.parse(await readFile(
        join(installed.plan.paths.result, "recall-preflight.json"),
        "utf8",
      )) as unknown).toEqual(failedPreflight);
    });
  });

  it("fails installed setup without launching Codex or falling back", async () => {
    await withRuntimeFixture(async (fixture) => {
      const calls: string[][] = [];
      const base = createFakeBoundary(fixture, calls);
      const runProcess = async (
        request: BoundaryProcessRequest,
      ): Promise<BoundaryProcessResult> => {
        if (request.args[0] === "setup") {
          calls.push([...request.args]);
          return processResult({ exitCode: 19, stderr: "setup failed" });
        }
        return base(request);
      };

      await expect(prepareC3InstalledArm({
        authFile: fixture.authFile,
        bunExecutable: process.execPath,
        codexExecutable: fixture.codexExecutable,
        npmExecutable: fixture.npmExecutable,
        packageTarball: fixture.packageTarball,
        plan: fixture.plans[1],
        runProcess,
      })).rejects.toThrow("goodmemory-setup exited with code 19");
      expect(calls.some((args) => args.includes("exec"))).toBe(false);
      expect(calls.some((args) => args[0] === "remember")).toBe(false);
    });
  });
});

interface RuntimeFixture {
  authFile: string;
  codexExecutable: string;
  npmExecutable: string;
  packageTarball: string;
  plans: ReturnType<typeof buildFrozenPrehistoryArmPlans>;
  root: string;
}

async function withRuntimeFixture(
  run: (fixture: RuntimeFixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-runtime-"));
  const authFile = join(root, "auth.json");
  const packageTarball = join(root, "goodmemory.tgz");
  const codexExecutable = join(root, "codex");
  const npmExecutable = join(root, "npm");
  const plans = buildFrozenPrehistoryArmPlans({
    episodeId: "episode-001",
    repetition: 1,
    resultRoot: join(root, "results"),
    runId: "c3-runtime-test",
    runtimeRoot: join(root, "runtime"),
    seed: 1,
    stageId: "stage-2",
    workspaceRoot: join(root, "workspaces"),
  });
  try {
    await Promise.all([
      writeFile(authFile, "{}\n", "utf8"),
      writeFile(packageTarball, "fake tarball\n", "utf8"),
      writeFile(codexExecutable, "fake codex\n", "utf8"),
      writeFile(npmExecutable, "fake npm\n", "utf8"),
      ...plans.map(async (plan) => {
        await mkdir(plan.paths.workspace, { recursive: true });
        await writeFile(
          join(plan.paths.workspace, "AGENTS.md"),
          "# Shared task instructions\n",
          "utf8",
        );
      }),
    ]);
    await run({
      authFile,
      codexExecutable: await realpath(codexExecutable),
      npmExecutable: await realpath(npmExecutable),
      packageTarball,
      plans,
      root,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function createFakeBoundary(
  fixture: RuntimeFixture,
  calls: string[][],
  codexConfig = "[features]\nhooks = true\n",
): (request: BoundaryProcessRequest) => Promise<BoundaryProcessResult> {
  return async (request) => {
    calls.push([...request.args]);
    if (request.executable === fixture.npmExecutable) {
      const prefix = request.args[request.args.indexOf("--prefix") + 1]!;
      await mkdir(join(prefix, "bin"), { recursive: true });
      await Promise.all([
        writeFile(join(prefix, "bin", "goodmemory"), "fake\n", "utf8"),
        writeFile(join(prefix, "bin", "goodmemory-mcp"), "fake\n", "utf8"),
      ]);
      return processResult();
    }
    if (request.executable === fixture.codexExecutable) {
      if (request.args[0] === "--version") {
        return processResult({ stdout: "codex-cli 0.144.3\n" });
      }
      if (
        request.args.includes("features") &&
        request.args.includes("list")
      ) {
        return processResult({
          stdout: "hooks stable true\nmemories experimental false\n",
        });
      }
    }
    if (request.args[0] === "--version") {
      return processResult({ stdout: "0.5.1\n" });
    }
    if (request.args[0] === "setup") {
      const home = request.env?.GOODMEMORY_HOME!;
      const codexHome = request.env?.CODEX_HOME!;
      await mkdir(join(home, ".goodmemory"), { recursive: true });
      await mkdir(codexHome, { recursive: true });
      await writeFile(
        join(home, ".goodmemory", "codex.json"),
        `${JSON.stringify({
          activationMode: "global",
          host: "codex",
          maxTokens: 256,
          retrievalProfile: "coding_agent",
          storage: {
            path: join(home, ".goodmemory", "memory.sqlite"),
            provider: "sqlite",
          },
          userId: fixture.plans[1].scopes.userId,
          version: 1,
          writeback: {
            mode: "selective",
            persistRawTranscript: false,
          },
        }, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(codexHome, "hooks.json"),
        managedHooks(home),
        "utf8",
      );
      await writeFile(join(codexHome, "config.toml"), codexConfig, "utf8");
      return processResult({ stdout: "{}\n" });
    }
    if (request.args[0] === "status") {
      return processResult({ stdout: `${JSON.stringify({
        hosts: [{
          activationMode: "global",
          hookRegistered: true,
          host: "codex",
          mcpRegistered: true,
          retrievalProfile: "coding_agent",
          scope: {
            userId: fixture.plans[1].scopes.userId,
            workspaceId: fixture.plans[1].scopes.workspaceId,
          },
          storage: {
            location: join(
              fixture.plans[1].paths.home,
              ".goodmemory",
              "memory.sqlite",
            ),
            provider: "sqlite",
          },
          workspaceStatus: "ok",
          writeback: { mode: "selective", persistRawTranscript: false },
        }],
      })}\n` });
    }
    if (request.args[0] === "doctor") {
      return processResult({ stdout: "{}\n" });
    }
    if (request.args[0] === "codex" && request.args[1] === "writeback") {
      if (request.args[2] === "inspect") {
        return processResult({ stdout: `${JSON.stringify({
          events: [{
            command: "session-end",
            contentPreview: "Remember c3 transport normalization.",
            linkedRecordIds: [{ id: "memory-seeded-001", type: "memory" }],
            recallHitCount: 0,
            recalledBy: [],
            sessionDigest: "session:bafde89c041e1756082b933a",
            status: "committed",
          }],
          host: "codex",
        })}\n` });
      }
      return processResult({ stdout: `${JSON.stringify({
        reason: "written",
        trace: {
          rawTranscriptPersisted: false,
          transcriptPathUsed: true,
          transcriptSessionDigest: "session:bafde89c041e1756082b933a",
        },
        wrote: true,
      })}\n` });
    }
    if (
      request.args[0] === "codex" &&
      request.args[1] === "hook" &&
      request.args[2] === "user-prompt-submit"
    ) {
      const home = request.env?.GOODMEMORY_HOME!;
      const hookInput = JSON.parse(String(request.stdin)) as {
        session_id: string;
      };
      await writeFile(
        join(home, ".goodmemory", "codex-injection-state.json"),
        `${JSON.stringify({
          events: [{
            command: "user-prompt-submit",
            decision: "injected",
            recordIds: ["memory-seeded-001"],
            sessionDigest: buildNativeCanarySessionDigest(hookInput.session_id),
          }],
          version: 1,
        })}\n`,
        "utf8",
      );
      return processResult({ stdout: `${JSON.stringify({
        hookSpecificOutput: {
          additionalContext: "Developer memory notes: parseTransportMode",
          hookEventName: "UserPromptSubmit",
        },
      })}\n` });
    }
    if (request.args[0] === "export-memory") {
      const output = request.args[request.args.indexOf("--output") + 1]!;
      await mkdir(output, { recursive: true });
      await writeFile(
        join(output, "memory-export.json"),
        '{"memories":[{"content":"c3 transport inputs are trimmed before validation"}]}\n',
        "utf8",
      );
      return processResult({ stdout: "{}\n" });
    }
    throw new Error(`unexpected fake process: ${request.executable} ${request.args.join(" ")}`);
  };
}

function processResult(
  overrides: Partial<BoundaryProcessResult> = {},
): BoundaryProcessResult {
  return {
    durationMs: 1,
    exitCode: 0,
    stderr: "",
    stdout: "",
    timedOut: false,
    ...overrides,
  };
}

function managedHooks(home: string): string {
  const command = (hook: string) =>
    `GOODMEMORY_HOME='${home}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook ${hook}`;
  return `${JSON.stringify({
    hooks: {
      PreToolUse: [{
        hooks: [{ command: command("pre-tool-use"), type: "command" }],
        matcher: "Bash",
      }],
      SessionStart: [{
        hooks: [{ command: command("session-start"), type: "command" }],
        matcher: "startup|resume|clear|compact",
      }],
      Stop: [{
        hooks: [{ command: command("session-stop"), type: "command" }],
      }],
      UserPromptSubmit: [{
        hooks: [{ command: command("user-prompt-submit"), type: "command" }],
      }],
    },
  })}\n`;
}

function rolloutLine(role: "assistant" | "user", text: string): string {
  return JSON.stringify({
    payload: {
      content: [{
        text,
        type: role === "user" ? "input_text" : "output_text",
      }],
      role,
      type: "message",
    },
    type: "response_item",
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
