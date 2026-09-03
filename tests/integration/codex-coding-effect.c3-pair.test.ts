import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  runC3FrozenPrehistoryPair,
} from "../../scripts/codex-coding-effect/c3-pair-runner";
import {
  buildFrozenPrehistoryArmPlans,
} from "../../scripts/codex-coding-effect/c3-arms";
import {
  projectC3RunEvidence,
} from "../../scripts/codex-coding-effect/c3-projection";
import {
  verifyC3Projection,
} from "../../scripts/codex-coding-effect/c3-verifier";
import {
  runC3BaseHealthProbe,
} from "../../scripts/codex-coding-effect/c3-base-health";
import {
  buildC3HostConfigurationEvidence,
} from "../../scripts/codex-coding-effect/c3-host-configuration";
import type {
  C3HostPreflightEvidence,
} from "../../scripts/codex-coding-effect/c3-host-preflight";
import {
  removeC3ArmModelCredential,
} from "../../scripts/codex-coding-effect/c3-runtime";
import {
  buildCodexEvaluatorSandboxConfigSha256,
} from "../../scripts/codex-coding-effect/evaluator-sandbox";
import {
  C3_BASE_DENIED_READ_LABELS,
  C3_INSTALLED_DENIED_READ_LABELS,
} from "../../scripts/codex-coding-effect/c3-permission-isolation";
import type {
  C3InstalledArmRuntime,
  C3NoMemoryArmRuntime,
  C3PermissionIsolationEvidence,
  C3BaselineArmRuntime,
} from "../../scripts/codex-coding-effect/c3-runtime";
import type { CodexRunRequest, CodexRunResult } from "../../scripts/codex-coding-effect/codex-runner";
import { runBoundaryProcess } from "../../scripts/codex-coding-effect/process";

describe("Codex coding-effect C3 paired runner", () => {
  it("writes identity before selective seeding and lets hidden tests score both arms", async () => {
    await withPairFixture(async (fixture) => {
      let identityExistedAtSeed = false;
      const sequence: string[] = [];
      const sourceProvenanceRoots: Array<string | undefined> = [];
      const evaluatorProcessCount = { value: 0 };
      const evaluatorRootsUsed: string[] = [];
      const preparedDeniedReadPaths = new Map<
        "goodmemory-installed" | "no-memory",
        readonly string[]
      >();
      const auditedDeniedReadPaths: Array<{
        arm: "goodmemory-installed" | "no-memory";
        paths: ReadonlyArray<{ label: string; path: string }>;
        phase: "pre-launch" | "pre-seed" | "preflight";
      }> = [];
      const result = await runPair(fixture, "paired-success", {
        auditedDeniedReadPaths,
        evaluatorProcessCount,
        evaluatorRootsUsed,
        onSeed: async (outputDirectory) => {
          identityExistedAtSeed = await Bun.file(
            join(outputDirectory, "run-identity.json"),
          ).exists();
        },
        preparedDeniedReadPaths,
        sequence,
        sourceProvenanceRoots,
      });

      expect(identityExistedAtSeed).toBe(true);
      expect(sequence).toEqual([
        "base-health",
        "codex:no-memory",
        "materialize-prehistory",
        "seed-installed",
        "preflight-recall",
        "codex:goodmemory-installed",
        "credential:no-memory",
        "credential:goodmemory-installed",
        "materialize-evaluator",
        "sandbox:no-memory",
        "sandbox:goodmemory-installed",
      ]);
      expect(evaluatorProcessCount.value).toBe(4);
      expect(evaluatorRootsUsed).toEqual([
        join(
          fixture.root,
          "paired-success-runtime",
          "evaluator-sandboxes",
          "no-memory",
          "evaluator",
        ),
        join(
          fixture.root,
          "paired-success-runtime",
          "evaluator-sandboxes",
          "no-memory",
          "evaluator",
        ),
        join(
          fixture.root,
          "paired-success-runtime",
          "evaluator-sandboxes",
          "goodmemory-installed",
          "evaluator",
        ),
        join(
          fixture.root,
          "paired-success-runtime",
          "evaluator-sandboxes",
          "goodmemory-installed",
          "evaluator",
        ),
      ]);
      expect(sourceProvenanceRoots).toEqual([
        undefined,
        fixture.sourceRepository,
        undefined,
        fixture.sourceRepository,
      ]);
      for (const arm of ["no-memory", "goodmemory-installed"] as const) {
        expect(preparedDeniedReadPaths.get(arm)).toEqual(expect.arrayContaining([
          fixture.authFile,
          fixture.evaluatorRoot,
          fixture.packageTarball,
          fixture.prehistoryPath,
          fixture.sourceRepository,
        ]));
      }
      const [noMemoryPlan, installedPlan] = buildFrozenPrehistoryArmPlans({
        episodeId: "episode-001",
        repetition: 1,
        resultRoot: join(fixture.root, "paired-success-output", "arms"),
        runId: "paired-success",
        runtimeRoot: join(fixture.root, "paired-success-runtime"),
        seed: 1,
        stageId: "stage-2",
        workspaceRoot: join(fixture.root, "paired-success-workspaces"),
      });
      expect(preparedDeniedReadPaths.get("no-memory")).toContain(
        noMemoryPlan.paths.armRoot,
      );
      expect(preparedDeniedReadPaths.get("goodmemory-installed")).toContain(
        installedPlan.paths.armRoot,
      );
      for (const arm of ["no-memory", "goodmemory-installed"] as const) {
        const audit = auditedDeniedReadPaths.find((entry) =>
          entry.arm === arm && entry.phase === "preflight"
        );
        expect(audit?.paths).toEqual(expect.arrayContaining([
          {
            label: "current-runtime-auth",
            path: join(
              arm === "no-memory"
                ? noMemoryPlan.paths.codexHome
                : installedPlan.paths.codexHome,
              "auth.json",
            ),
          },
          {
            label: "other-arm-runtime-auth",
            path: join(
              arm === "no-memory"
                ? installedPlan.paths.codexHome
                : noMemoryPlan.paths.codexHome,
              "auth.json",
            ),
          },
        ]));
      }
      expect(result.cases.map((row) => ({
        arm: row.arm,
        disposition: row.disposition,
        resolved: row.resolved,
      }))).toEqual([
        { arm: "no-memory", disposition: "finalized", resolved: false },
        {
          arm: "goodmemory-installed",
          disposition: "finalized",
          resolved: true,
        },
      ]);
      expect(result.summary).toMatchObject({
        comparablePairs: 1,
        evidenceClass: "frozen-prehistory-pilot",
        memoryDiagnosticsUsedForTaskScore: false,
        outcome: "rescue",
        resolvedCount: 1,
        taskScoringSource: "deterministic-hidden-tests",
      });
      const outputDirectory = join(
        fixture.root,
        "paired-success-output",
      );
      const identity = JSON.parse(await readFile(
        join(outputDirectory, "run-identity.json"),
        "utf8",
      )) as Record<string, unknown>;
      expect(identity).toMatchObject({
        goodMemorySource: {
          commit: expect.stringMatching(/^[a-f0-9]{40}$/u),
          dirtyStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          tree: expect.stringMatching(/^[a-f0-9]{40}$/u),
        },
        baseHealthSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        hostConfigurationsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        hostPreflightSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        evaluator: {
          security: {
            arms: {
              goodmemoryInstalled: {
                evaluationWorkspace: {
                  path: join(
                    fixture.root,
                    "paired-success-runtime",
                    "evaluator-sandboxes",
                    "goodmemory-installed",
                    "workspace",
                  ),
                },
                evaluatorRoot: {
                  path: join(
                    fixture.root,
                    "paired-success-runtime",
                    "evaluator-sandboxes",
                    "goodmemory-installed",
                    "evaluator",
                  ),
                },
              },
              noMemory: {
                evaluationWorkspace: {
                  path: join(
                    fixture.root,
                    "paired-success-runtime",
                    "evaluator-sandboxes",
                    "no-memory",
                    "workspace",
                  ),
                },
                evaluatorRoot: {
                  path: join(
                    fixture.root,
                    "paired-success-runtime",
                    "evaluator-sandboxes",
                    "no-memory",
                    "evaluator",
                  ),
                },
              },
            },
            credentialRemoval:
              "after-both-codex-before-evaluator-materialization",
            evidencePath: "evaluator-security.sanitized.json",
            profileName: "c3-evaluator",
            sourceEvaluatorRoot: {
              path: fixture.evaluatorRoot,
            },
          },
        },
        runnerSource: {
          commit: expect.stringMatching(/^[a-f0-9]{40}$/u),
          dirtyStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          tree: expect.stringMatching(/^[a-f0-9]{40}$/u),
        },
      });
      expect(JSON.parse(await readFile(
        join(outputDirectory, "base-health.json"),
        "utf8",
      ))).toMatchObject({
        hiddenEvaluatorLifecycle: "stdin-data-url-no-file",
        passed: true,
      });
      expect(JSON.parse(await readFile(
        join(outputDirectory, "host-preflight.sanitized.json"),
        "utf8",
      ))).toMatchObject({
        networkMode: "disabled",
        schemaVersion: 1,
      });
      const hostConfigurations = JSON.parse(await readFile(
        join(outputDirectory, "host-configurations.sanitized.json"),
        "utf8",
      )) as {
        normalizedDiff: Array<{ path: string }>;
      };
      expect(hostConfigurations.normalizedDiff.map((entry) => entry.path)).toContain(
        "goodmemoryConfig",
      );
      const evaluatorSecurityBytes = await readFile(
        join(outputDirectory, "evaluator-security.sanitized.json"),
        "utf8",
      );
      expect(JSON.parse(evaluatorSecurityBytes)).toMatchObject({
        contract: {
          profileName: "c3-evaluator",
        },
        credentialRevocations: {
          goodmemoryInstalled: {
            arm: "goodmemory-installed",
            copiedAuthRemovedBeforeEvaluator: true,
          },
          noMemory: {
            arm: "no-memory",
            copiedAuthRemovedBeforeEvaluator: true,
          },
        },
        sandboxes: {
          goodmemoryInstalled: {
            configWriteDenied: true,
            evaluatorRead: true,
            evaluatorWriteDenied: true,
            networkAccess: false,
            networkDenied: true,
            networkPositiveControl: true,
            originalAuthAliasDenied: true,
            originalAuthDenied: true,
            profileName: "c3-evaluator",
          },
          noMemory: {
            configWriteDenied: true,
            evaluatorRead: true,
            evaluatorWriteDenied: true,
            networkAccess: false,
            networkDenied: true,
            networkPositiveControl: true,
            originalAuthAliasDenied: true,
            originalAuthDenied: true,
            profileName: "c3-evaluator",
          },
        },
        schemaVersion: 1,
      });
      const auditEvidence = JSON.parse(await readFile(
        join(outputDirectory, "audit-evidence.sanitized.json"),
        "utf8",
      ));
      expect(auditEvidence).toMatchObject({
        evidenceClass: "frozen-prehistory-pilot",
        evaluatorSecuritySha256: sha256(evaluatorSecurityBytes),
        hostConfigurationsSha256: identity.hostConfigurationsSha256,
        outcome: "rescue",
        runId: "paired-success",
        schemaVersion: 1,
      });
      await access(join(
        outputDirectory,
        "sealed-prehistory",
        "rollout-2026-07-15T00-00-00-11111111-1111-1111-1111-111111111111.jsonl",
      ));
      const stageEvidence = await readStageEvidence(
        join(fixture.root, "paired-success-output", "stage-evidence"),
      );
      expect(stageEvidence.find((row) =>
        row.armEvidence.arm === "goodmemory-installed"
      )?.armEvidence.hostCanary).toMatchObject({
        injectedExpectedMemoryIds: ["memory-001"],
        passed: true,
        stopCursorAdvanced: true,
      });
      expect(stageEvidence.every((row) =>
        row.armEvidence.evaluatorSecuritySha256 ===
          sha256(evaluatorSecurityBytes)
      )).toBe(true);

      const projectionDirectory = join(
        fixture.root,
        "paired-success-projection",
      );
      const projection = await projectC3RunEvidence({
        outputDirectory: projectionDirectory,
        rawRunDirectory: outputDirectory,
      });
      expect(projection).toMatchObject({
        evidenceClass: "frozen-prehistory-pilot",
        runId: "paired-success",
        schemaVersion: 1,
      });
      expect(
        await readFile(join(projectionDirectory, "run-identity.json"), "utf8"),
      ).not.toContain(fixture.root);

      const verification = await verifyC3Projection({
        projectionDirectory,
        replayFixture: async () => ({
          bunExecutable: process.execPath,
          cleanup: async () => undefined,
          evaluatorFiles: fixture.evaluatorFiles,
          evaluatorRoot: fixture.evaluatorRoot,
          expectedCommit: fixture.commit,
          expectedFailToPassOutputFragments: ["C3_EXPECTED_BASE_FAILURE"],
          failToPassCommand: [
            process.execPath,
            "{evaluatorRoot}/fail-to-pass.ts",
          ],
          failToPassSource: fixture.failToPassBytes,
          passToPassCommand: [
            process.execPath,
            "{evaluatorRoot}/pass-to-pass.ts",
          ],
          passToPassSource: fixture.passToPassBytes,
          sourceRepository: fixture.sourceRepository,
          visibleBaseHealthCommand: [
            process.execPath,
            "-e",
            "process.exit(0)",
          ],
        }),
        testOnlyCollectVerifierSource:
          projectedRunnerSourceCollector(projectionDirectory),
      });
      expect(verification).toMatchObject({
        decision: "accepted",
        externalAuthenticityVerified: false,
        replayedArmCount: 2,
        runId: "paired-success",
        schemaVersion: 1,
        verificationScope:
          "internal-consistency-and-clean-clone-patch-replay",
      });
    });
  }, 15_000);

  it("keeps projection mechanical and lets the independent verifier reject tampering", async () => {
    await withPairFixture(async (fixture) => {
      await runPair(fixture, "paired-tampered");
      const outputDirectory = join(fixture.root, "paired-tampered-output");
      const [stagePath] = await stageEvidencePaths(
        join(outputDirectory, "stage-evidence"),
      );
      if (stagePath === undefined) {
        throw new Error("expected C3 stage evidence");
      }
      const stage = JSON.parse(await readFile(stagePath, "utf8")) as {
        patchDiff: string;
      };
      stage.patchDiff = `${stage.patchDiff}\n`;
      await writeFile(stagePath, `${JSON.stringify(stage, null, 2)}\n`, "utf8");

      const projectionDirectory = join(
        fixture.root,
        "paired-tampered-projection",
      );
      await projectC3RunEvidence({
        outputDirectory: projectionDirectory,
        rawRunDirectory: outputDirectory,
      });
      const verification = await verifyC3Projection({
        projectionDirectory,
        replayFixture: async () => ({
          bunExecutable: process.execPath,
          cleanup: async () => undefined,
          evaluatorFiles: fixture.evaluatorFiles,
          evaluatorRoot: fixture.evaluatorRoot,
          expectedCommit: fixture.commit,
          expectedFailToPassOutputFragments: ["C3_EXPECTED_BASE_FAILURE"],
          failToPassCommand: [
            process.execPath,
            "{evaluatorRoot}/fail-to-pass.ts",
          ],
          failToPassSource: fixture.failToPassBytes,
          passToPassCommand: [
            process.execPath,
            "{evaluatorRoot}/pass-to-pass.ts",
          ],
          passToPassSource: fixture.passToPassBytes,
          sourceRepository: fixture.sourceRepository,
          visibleBaseHealthCommand: [
            process.execPath,
            "-e",
            "process.exit(0)",
          ],
        }),
        testOnlyCollectVerifierSource:
          projectedRunnerSourceCollector(projectionDirectory),
      });
      expect(verification.decision).toBe("rejected");
      expect(verification.reasons).toContain(
        "stage patch hash does not match the recorded case",
      );
    });
  });

  it("rejects self-rehashed protocol tampering and reruns base health on a fresh clone", async () => {
    await withPairFixture(async (fixture) => {
      await runPair(fixture, "paired-protocol-tampering");
      const canonical = join(fixture.root, "paired-protocol-projection");
      await projectC3RunEvidence({
        outputDirectory: canonical,
        rawRunDirectory: join(
          fixture.root,
          "paired-protocol-tampering-output",
        ),
      });

      const mismatchedVerifierSource = await projectedRunnerSourceCollector(
        canonical,
      )();
      const mismatchedProvenance = {
        ...mismatchedVerifierSource.provenance,
        tree: "e".repeat(40),
      };
      const verifierMismatch = await verifyC3Projection({
        projectionDirectory: canonical,
        testOnlyCollectVerifierSource: async () => ({
          ...mismatchedVerifierSource,
          provenance: mismatchedProvenance,
        }),
      });
      expect(verifierMismatch.reasons).toContain(
        "C3 verifier checkout does not match the recorded runner source",
      );

      const baseMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-base-mutation"),
      );
      const baseHealth = await readProjectionJson(baseMutation, "base-health.json");
      const visibleProbe = asObject(asObject(baseHealth.probes).visible);
      const visibleCommand = asStringArray(visibleProbe.command);
      visibleProbe.command = [
        ...visibleCommand.slice(0, -1),
        "process.exit(1)",
      ];
      const baseHealthBytes = jsonBytes(baseHealth);
      const baseIdentity = await readProjectionJson(
        baseMutation,
        "run-identity.json",
      );
      baseIdentity.baseHealthSha256 = sha256(baseHealthBytes);
      const baseAudit = await readProjectionJson(
        baseMutation,
        "audit-evidence.sanitized.json",
      );
      baseAudit.baseHealthSha256 = sha256(baseHealthBytes);
      await rewriteProjectionFiles(baseMutation, new Map([
        ["base-health.json", baseHealthBytes],
        ["run-identity.json", jsonBytes(baseIdentity)],
        ["audit-evidence.sanitized.json", jsonBytes(baseAudit)],
      ]));
      expect((await verifyPairProjection(baseMutation, fixture)).reasons)
        .toContain(
          "C3 fresh-clone base-health does not match the projected evidence",
        );

      const argvMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-argv-mutation"),
      );
      const argvIdentity = await readProjectionJson(
        argvMutation,
        "run-identity.json",
      );
      const noMemory = asObject(asObject(argvIdentity.arms).noMemory);
      const argv = asStringArray(noMemory.normalizedArgv);
      noMemory.normalizedArgv = argv.filter((value, index) =>
        !(value === "--disable" && argv[index + 1] === "memories") &&
        !(value === "memories" && argv[index - 1] === "--disable")
      );
      noMemory.normalizedArgvSha256 = sha256(
        JSON.stringify(noMemory.normalizedArgv),
      );
      await rewriteProjectionFiles(argvMutation, new Map([
        ["run-identity.json", jsonBytes(argvIdentity)],
      ]));
      expect((await verifyPairProjection(argvMutation, fixture)).reasons)
        .toContain("C3 no-memory normalized argv is inconsistent");

      const permissionMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-permission-mutation"),
      );
      const installedStagePath = await findProjectedStage(
        permissionMutation,
        "goodmemory-installed",
      );
      const installedStage = await readProjectionJson(
        permissionMutation,
        installedStagePath,
      );
      const permissionIsolation = asObject(
        asObject(installedStage.armEvidence).permissionIsolation,
      );
      const permissionAudit = asObject(permissionIsolation.audit);
      permissionAudit.phase = "pre-seed";
      const deniedReads = asObjectArray(permissionAudit.deniedReads);
      deniedReads[0]!.label = "forged-deny-label";
      permissionIsolation.evidenceSha256 = sha256(jsonBytes(permissionAudit));
      await rewriteProjectionFiles(permissionMutation, new Map([
        [installedStagePath, jsonBytes(installedStage)],
      ]));
      expect((await verifyPairProjection(permissionMutation, fixture)).reasons)
        .toContain("C3 permission isolation evidence is inconsistent");

      const permissionNetworkMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-permission-network-mutation"),
      );
      const networkStagePath = await findProjectedStage(
        permissionNetworkMutation,
        "goodmemory-installed",
      );
      const networkStage = await readProjectionJson(
        permissionNetworkMutation,
        networkStagePath,
      );
      const networkIsolation = asObject(
        asObject(networkStage.armEvidence).permissionIsolation,
      );
      const networkAudit = asObject(networkIsolation.audit);
      networkAudit.networkDenied = false;
      networkIsolation.evidenceSha256 = sha256(jsonBytes(networkAudit));
      await rewriteProjectionFiles(permissionNetworkMutation, new Map([
        [networkStagePath, jsonBytes(networkStage)],
      ]));
      expect(
        (await verifyPairProjection(permissionNetworkMutation, fixture)).reasons,
      ).toContain("invalid C3 arm evidence");

      const packageMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-package-mutation"),
      );
      const packageStagePath = await findProjectedStage(
        packageMutation,
        "goodmemory-installed",
      );
      const packageStage = await readProjectionJson(
        packageMutation,
        packageStagePath,
      );
      asObject(asObject(packageStage.armEvidence).package).sha256 = "f".repeat(64);
      await rewriteProjectionFiles(packageMutation, new Map([
        [packageStagePath, jsonBytes(packageStage)],
      ]));
      expect((await verifyPairProjection(packageMutation, fixture)).reasons)
        .toContain(
          "C3 stage host evidence is not cross-bound to the run identity",
        );

      const hostDiffMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-host-diff-mutation"),
      );
      const hostConfigurations = await readProjectionJson(
        hostDiffMutation,
        "host-configurations.sanitized.json",
      );
      asObjectArray(hostConfigurations.normalizedDiff)[0]!.path =
        "forged.semantic.path";
      const hostConfigurationsBytes = jsonBytes(hostConfigurations);
      const hostPreflight = await readProjectionJson(
        hostDiffMutation,
        "host-preflight.sanitized.json",
      );
      hostPreflight.hostConfigurationsSha256 = sha256(hostConfigurationsBytes);
      const hostPreflightBytes = jsonBytes(hostPreflight);
      const hostIdentity = await readProjectionJson(
        hostDiffMutation,
        "run-identity.json",
      );
      hostIdentity.hostConfigurationsSha256 = sha256(hostConfigurationsBytes);
      hostIdentity.hostConfigurationDiffSha256 = sha256(
        JSON.stringify(hostConfigurations.normalizedDiff),
      );
      hostIdentity.hostPreflightSha256 = sha256(hostPreflightBytes);
      const hostAudit = await readProjectionJson(
        hostDiffMutation,
        "audit-evidence.sanitized.json",
      );
      hostAudit.hostConfigurationsSha256 = sha256(hostConfigurationsBytes);
      hostAudit.hostConfigurationDiffSha256 =
        hostIdentity.hostConfigurationDiffSha256;
      hostAudit.hostPreflightSha256 = sha256(hostPreflightBytes);
      await rewriteProjectionFiles(hostDiffMutation, new Map([
        ["host-configurations.sanitized.json", hostConfigurationsBytes],
        ["host-preflight.sanitized.json", hostPreflightBytes],
        ["run-identity.json", jsonBytes(hostIdentity)],
        ["audit-evidence.sanitized.json", jsonBytes(hostAudit)],
      ]));
      expect((await verifyPairProjection(hostDiffMutation, fixture)).reasons)
        .toContain("C3 host configuration hashes are inconsistent");

      const evaluatorSecurityMutation = await cloneProjection(
        canonical,
        join(fixture.root, "projection-evaluator-security-mutation"),
      );
      const evaluatorSecurity = await readProjectionJson(
        evaluatorSecurityMutation,
        "evaluator-security.sanitized.json",
      );
      asObject(asObject(evaluatorSecurity.sandboxes).noMemory).configSha256 =
        "f".repeat(64);
      const evaluatorSecurityBytes = jsonBytes(evaluatorSecurity);
      const evaluatorSecuritySha256 = sha256(evaluatorSecurityBytes);
      const securityAudit = await readProjectionJson(
        evaluatorSecurityMutation,
        "audit-evidence.sanitized.json",
      );
      securityAudit.evaluatorSecuritySha256 = evaluatorSecuritySha256;
      const securityStagePaths = await projectedStagePaths(
        evaluatorSecurityMutation,
      );
      const securityStageFiles = new Map<string, string>([
        [
          "evaluator-security.sanitized.json",
          evaluatorSecurityBytes,
        ],
        [
          "audit-evidence.sanitized.json",
          jsonBytes(securityAudit),
        ],
      ]);
      for (const stagePath of securityStagePaths) {
        const stage = await readProjectionJson(
          evaluatorSecurityMutation,
          stagePath,
        );
        asObject(stage.armEvidence).evaluatorSecuritySha256 =
          evaluatorSecuritySha256;
        securityStageFiles.set(stagePath, jsonBytes(stage));
      }
      await rewriteProjectionFiles(
        evaluatorSecurityMutation,
        securityStageFiles,
      );
      expect(
        (await verifyPairProjection(evaluatorSecurityMutation, fixture)).reasons,
      ).toContain("C3 evaluator security evidence is inconsistent");

      const evaluatorSecurityDeletion = await cloneProjection(
        canonical,
        join(fixture.root, "projection-evaluator-security-deletion"),
      );
      await rm(
        join(
          evaluatorSecurityDeletion,
          "evaluator-security.sanitized.json",
        ),
      );
      expect(
        (await verifyPairProjection(evaluatorSecurityDeletion, fixture)).reasons,
      ).toContain("C3 projection files do not match the manifest");
    });
  });

  it("rejects a projection whose raw identity commitment is unbound", async () => {
    await withPairFixture(async (fixture) => {
      await runPair(fixture, "paired-source-identity-tampered");
      const outputDirectory = join(
        fixture.root,
        "paired-source-identity-tampered-output",
      );
      const projectionDirectory = join(
        fixture.root,
        "paired-source-identity-tampered-projection",
      );
      await projectC3RunEvidence({
        outputDirectory: projectionDirectory,
        rawRunDirectory: outputDirectory,
      });
      const manifestPath = join(
        projectionDirectory,
        "projection-manifest.json",
      );
      const manifest = JSON.parse(await readFile(
        manifestPath,
        "utf8",
      )) as {
        sourceRunIdentitySha256: string;
      };
      manifest.sourceRunIdentitySha256 = "f".repeat(64);
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );

      const verification = await verifyC3Projection({
        projectionDirectory,
        testOnlyCollectVerifierSource:
          projectedRunnerSourceCollector(projectionDirectory),
      });
      expect(verification.decision).toBe("rejected");
      expect(verification.reasons).toContain(
        "C3 source run identity commitment is inconsistent",
      );
    });
  });

  it("rejects package identity values that contradict host and stage evidence", async () => {
    await withPairFixture(async (fixture) => {
      await runPair(fixture, "paired-package-identity-tampered");
      const outputDirectory = join(
        fixture.root,
        "paired-package-identity-tampered-output",
      );
      const projectionDirectory = join(
        fixture.root,
        "paired-package-identity-tampered-projection",
      );
      await projectC3RunEvidence({
        outputDirectory: projectionDirectory,
        rawRunDirectory: outputDirectory,
      });
      const identityPath = join(projectionDirectory, "run-identity.json");
      const identity = JSON.parse(await readFile(identityPath, "utf8")) as {
        arms: {
          goodmemoryInstalled: {
            package: {
              sha256: string;
              version: string;
            };
          };
        };
      };
      identity.arms.goodmemoryInstalled.package = {
        sha256: "e".repeat(64),
        version: "99.0.0",
      };
      await rewriteProjectedFile(
        projectionDirectory,
        "run-identity.json",
        `${JSON.stringify(identity, null, 2)}\n`,
      );

      const verification = await verifyC3Projection({
        projectionDirectory,
        testOnlyCollectVerifierSource:
          projectedRunnerSourceCollector(projectionDirectory),
      });
      expect(verification.decision).toBe("rejected");
      expect(verification.reasons).toContain(
        "C3 package, host configuration, and permission identities are not cross-bound",
      );
    });
  });

  it("keeps a missing installed injection as infrastructure failure instead of fallback", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-canary-failure", {
        canaryFailure: true,
      });

      expect(result.cases[1]).toMatchObject({
        arm: "goodmemory-installed",
        disposition: "infrastructure-failure",
        executionFailureStage: "goodmemory-injection",
        failToPassStatus: "passed",
        passToPassStatus: "passed",
        resolved: false,
        taskFailureReasons: [],
      });
      expect(result.summary).toMatchObject({
        comparablePairs: 0,
        infrastructureFailureCount: 1,
        outcome: "incomparable",
        resolvedCount: 0,
      });
    });
  });

  it("persists failed live base health and stops before either Codex process", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];
      await expect(runPair(fixture, "paired-base-health-failure", {
        baseHealthFailure: true,
        sequence,
      })).rejects.toThrow("C3 live base-health failed");
      expect(sequence).toEqual(["base-health"]);
      expect(JSON.parse(await readFile(
        join(
          fixture.root,
          "paired-base-health-failure-output",
          "base-health.json",
        ),
        "utf8",
      ))).toMatchObject({
        passed: false,
        reasons: ["injected base-health failure"],
      });
    });
  });

  it("rejects mutable run output inside the actual runner checkout", async () => {
    await withPairFixture(async (fixture) => {
      await expect(runPair(fixture, "paired-runner-overlap", {
        outputDirectory: join(
          process.cwd(),
          "reports",
          "eval",
          "research",
          "codex-coding-effect",
          "paired-runner-overlap",
        ),
      })).rejects.toThrow(
        "outputDirectory must not overlap the C3 runner source checkout",
      );
    });
  });

  it("persists host-preflight failure and stops before either Codex process", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];
      await expect(runPair(fixture, "paired-host-preflight-failure", {
        hostPreflightFailure: true,
        sequence,
      })).rejects.toThrow("injected host-preflight failure");
      expect(sequence).toEqual(["base-health"]);
      expect(JSON.parse(await readFile(
        join(
          fixture.root,
          "paired-host-preflight-failure-output",
          "host-preflight-failure.sanitized.json",
        ),
        "utf8",
      ))).toMatchObject({
        passed: false,
        reason: "injected host-preflight failure",
        schemaVersion: 1,
      });
    });
  });

  it("persists a failed recall preflight without launching the installed Codex arm", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];
      const result = await runPair(fixture, "paired-recall-preflight-failure", {
        recallPreflightFailure: true,
        sequence,
      });

      expect(sequence).toEqual([
        "base-health",
        "codex:no-memory",
        "materialize-prehistory",
        "seed-installed",
        "preflight-recall",
        "credential:no-memory",
        "credential:goodmemory-installed",
        "materialize-evaluator",
        "sandbox:no-memory",
        "sandbox:goodmemory-installed",
      ]);
      expect(result.cases[1]).toMatchObject({
        arm: "goodmemory-installed",
        codexStatus: "not-started",
        disposition: "infrastructure-failure",
        executionFailureStage: "goodmemory-recall-preflight",
        resolved: false,
      });
      expect(result.summary).toMatchObject({
        comparablePairs: 0,
        infrastructureFailureCount: 1,
        outcome: "incomparable",
      });
      const evidence = await readStageEvidence(join(
        fixture.root,
        "paired-recall-preflight-failure-output",
        "stage-evidence",
      ));
      expect(evidence.find((row) =>
        row.armEvidence.arm === "goodmemory-installed"
      )?.armEvidence).toMatchObject({
        hostCanary: null,
        recallPreflight: { passed: false },
      });
    });
  });

  it("converts a thrown recall preflight into durable incomparable evidence", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];
      const result = await runPair(fixture, "paired-recall-preflight-throw", {
        recallPreflightThrow: true,
        sequence,
      });

      expect(sequence).toEqual([
        "base-health",
        "codex:no-memory",
        "materialize-prehistory",
        "seed-installed",
        "preflight-recall",
        "credential:no-memory",
        "credential:goodmemory-installed",
        "materialize-evaluator",
        "sandbox:no-memory",
        "sandbox:goodmemory-installed",
      ]);
      expect(result.cases[1]).toMatchObject({
        arm: "goodmemory-installed",
        codexStatus: "not-started",
        disposition: "infrastructure-failure",
        executionFailureStage: "goodmemory-recall-preflight",
        resolved: false,
      });
      expect(result.summary).toMatchObject({
        comparablePairs: 0,
        infrastructureFailureCount: 1,
        outcome: "incomparable",
      });
      const evidence = await readStageEvidence(join(
        fixture.root,
        "paired-recall-preflight-throw-output",
        "stage-evidence",
      ));
      expect(evidence.find((row) =>
        row.armEvidence.arm === "goodmemory-installed"
      )?.armEvidence).toMatchObject({
        hostCanary: null,
        recallPreflight: {
          passed: false,
          reason: "injected preflight boundary failure",
        },
      });
    });
  });

  it("revalidates permission isolation immediately before installed Codex launch", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];

      await expect(runPair(fixture, "paired-pre-launch-permission-drift", {
        preLaunchPermissionFailure: true,
        sequence,
      })).rejects.toThrow("injected pre-launch permission drift");

      expect(sequence).toEqual([
        "base-health",
        "codex:no-memory",
        "materialize-prehistory",
        "seed-installed",
        "preflight-recall",
      ]);
    });
  });

  it("revalidates permission isolation immediately before no-memory Codex launch", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];

      await expect(runPair(fixture, "paired-no-memory-pre-launch-drift", {
        preLaunchPermissionFailureArm: "no-memory",
        sequence,
      })).rejects.toThrow("injected pre-launch permission drift");

      expect(sequence).toEqual(["base-health"]);
    });
  });

  it("persists an incomparable pair when a Codex process cannot start", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-codex-failure", {
        noMemoryLaunchFailure: true,
      });

      expect(result.cases[0]).toMatchObject({
        arm: "no-memory",
        disposition: "infrastructure-failure",
        executionFailureStage: "codex-launch",
        resolved: false,
      });
      expect(result.summary).toMatchObject({
        comparablePairs: 0,
        infrastructureFailureCount: 1,
        outcome: "incomparable",
      });
      await access(join(
        fixture.root,
        "paired-codex-failure-output",
        "summary.json",
      ));
    });
  });

  it("persists evaluator materialization drift as infrastructure evidence", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-evaluator-drift", {
        corruptEvaluator: true,
      });

      expect(result.cases.every((row) =>
        row.disposition === "infrastructure-failure" &&
        row.executionFailureStage === "test-harness-startup"
      )).toBe(true);
      expect(result.summary).toMatchObject({
        comparablePairs: 0,
        infrastructureFailureCount: 2,
        outcome: "incomparable",
      });
    });
  });

  it("stops before evaluator materialization when a copied model credential remains", async () => {
    await withPairFixture(async (fixture) => {
      const sequence: string[] = [];
      await expect(runPair(fixture, "paired-credential-removal-failure", {
        leaveCopiedCredentialArm: "no-memory",
        sequence,
      })).rejects.toThrow(
        "C3 no-memory copied model credential remained before evaluator materialization",
      );
      expect(sequence).not.toContain("materialize-evaluator");
    });
  });

  it("turns evaluator sandbox config drift into incomparable infrastructure evidence", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-evaluator-sandbox-drift", {
        sandboxConfigDriftArm: "no-memory",
      });
      expect(result.cases.every((row) =>
        row.disposition === "infrastructure-failure" &&
        row.executionFailureStage === "test-harness-startup"
      )).toBe(true);
      expect(
        await Bun.file(join(
          fixture.root,
          "paired-evaluator-sandbox-drift-output",
          "evaluator-security.sanitized.json",
        )).exists(),
      ).toBe(false);
    });
  });

  it("turns a missing network positive control into incomparable infrastructure evidence", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-network-control-failure", {
        missingNetworkPositiveControlArm: "goodmemory-installed",
      });
      expect(result.cases.every((row) =>
        row.disposition === "infrastructure-failure" &&
        row.executionFailureStage === "test-harness-startup"
      )).toBe(true);
    });
  });

  it("rejects a sandbox evaluator copy that drifts from the committed source", async () => {
    await withPairFixture(async (fixture) => {
      const result = await runPair(fixture, "paired-evaluator-copy-drift", {
        corruptSandboxEvaluatorArm: "no-memory",
      });
      expect(result.cases.every((row) =>
        row.disposition === "infrastructure-failure" &&
        row.executionFailureStage === "test-harness-startup"
      )).toBe(true);
      expect(
        await Bun.file(join(
          fixture.root,
          "paired-evaluator-copy-drift-output",
          "evaluator-security.sanitized.json",
        )).exists(),
      ).toBe(false);
    });
  });
});

interface PairFixture {
  authFile: string;
  commit: string;
  evaluatorFiles: ReadonlyArray<{ relativePath: string; sha256: string }>;
  failToPassBytes: string;
  evaluatorRoot: string;
  packageTarball: string;
  passToPassBytes: string;
  prehistoryBytes: string;
  prehistoryPath: string;
  prehistorySha256: string;
  root: string;
  sourceRepository: string;
}

async function withPairFixture(
  run: (fixture: PairFixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c3-pair-"));
  const sourceRepository = join(root, "source");
  const evaluatorRoot = join(root, "evaluator");
  const authFile = join(root, "auth.json");
  const packageTarball = join(root, "goodmemory.tgz");
  const prehistoryPath = join(
    root,
    "rollout-2026-07-15T00-00-00-11111111-1111-1111-1111-111111111111.jsonl",
  );
  const prehistory = `${rolloutLine(
    "user",
    "Remember that C3 deterministic result should be resolved.",
  )}\n`;
  const failToPassBytes = [
    'import { readFile } from "node:fs/promises";',
    'const value = await readFile("deterministic-result.txt", "utf8").catch(() => "");',
    'if (value !== "resolved\\n") console.error("C3_EXPECTED_BASE_FAILURE");',
    'process.exit(value === "resolved\\n" ? 0 : 1);',
    "",
  ].join("\n");
  const passToPassBytes = [
    'import { readFile } from "node:fs/promises";',
    'const value = await readFile("protected.txt", "utf8");',
    'process.exit(value === "protected\\n" ? 0 : 1);',
    "",
  ].join("\n");
  try {
    await mkdir(sourceRepository, { recursive: true });
    await Promise.all([
      writeFile(authFile, "{}\n", "utf8"),
      writeFile(packageTarball, "fake package\n", "utf8"),
      writeFile(
        join(sourceRepository, "AGENTS.md"),
        "# Shared deterministic instructions\n",
        "utf8",
      ),
      writeFile(join(sourceRepository, "protected.txt"), "protected\n", "utf8"),
    ]);
    await runGit(sourceRepository, ["init", "--quiet"]);
    await runGit(sourceRepository, ["config", "user.email", "fixture@example.test"]);
    await runGit(sourceRepository, ["config", "user.name", "Fixture"]);
    await runGit(sourceRepository, ["add", "."]);
    await runGit(sourceRepository, ["commit", "--quiet", "-m", "fixture"]);
    const commit = (await runGit(sourceRepository, ["rev-parse", "HEAD"])).trim();
    await run({
      authFile,
      commit,
      evaluatorFiles: [
        { relativePath: "fail-to-pass.ts", sha256: sha256(failToPassBytes) },
        { relativePath: "pass-to-pass.ts", sha256: sha256(passToPassBytes) },
      ],
      failToPassBytes,
      evaluatorRoot,
      packageTarball,
      passToPassBytes,
      prehistoryBytes: prehistory,
      prehistoryPath,
      prehistorySha256: sha256(prehistory),
      root,
      sourceRepository,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function runPair(
  fixture: PairFixture,
  suffix: string,
  options: {
    auditedDeniedReadPaths?: Array<{
      arm: string;
      paths: ReadonlyArray<{ label: string; path: string }>;
      phase: "pre-launch" | "pre-seed" | "preflight";
    }>;
    baseHealthFailure?: boolean;
    canaryFailure?: boolean;
    corruptEvaluator?: boolean;
    corruptSandboxEvaluatorArm?: "goodmemory-installed" | "no-memory";
    evaluatorProcessCount?: { value: number };
    evaluatorRootsUsed?: string[];
    hostPreflightFailure?: boolean;
    leaveCopiedCredentialArm?: "goodmemory-installed" | "no-memory";
    missingNetworkPositiveControlArm?: "goodmemory-installed" | "no-memory";
    noMemoryLaunchFailure?: boolean;
    onSeed?: (outputDirectory: string) => Promise<void>;
    outputDirectory?: string;
    preLaunchPermissionFailure?: boolean;
    preLaunchPermissionFailureArm?: "goodmemory-installed" | "no-memory";
    preparedDeniedReadPaths?: Map<
      "goodmemory-installed" | "no-memory",
      readonly string[]
    >;
    recallPreflightFailure?: boolean;
    recallPreflightThrow?: boolean;
    sandboxConfigDriftArm?: "goodmemory-installed" | "no-memory";
    sequence?: string[];
    sourceProvenanceRoots?: Array<string | undefined>;
  } = {},
) {
  const outputDirectory = options.outputDirectory ??
    join(fixture.root, `${suffix}-output`);
  const instructionSha256 = sha256(
    `AGENTS.md\0# Shared deterministic instructions\n\0`,
  );
  const copiedAuthPaths = new Map<
    "goodmemory-installed" | "no-memory",
    string
  >();
  return runC3FrozenPrehistoryPair({
    authFile: fixture.authFile,
    bunExecutable: process.execPath,
    codexExecutable: "/fake/codex",
    episodeId: "episode-001",
    evaluatorRoot: fixture.evaluatorRoot,
    evaluatorFiles: fixture.evaluatorFiles,
    expectedCommit: fixture.commit,
    expectedFailToPassOutputFragments: ["C3_EXPECTED_BASE_FAILURE"],
    failToPassSource: fixture.failToPassBytes,
    failToPassCommand: [process.execPath, "{evaluatorRoot}/fail-to-pass.ts"],
    declaredForbiddenSourceSha256: [],
    forbiddenSources: [],
    forbiddenStrings: [],
    generatedAt: "2026-07-15T12:00:00.000Z",
    goodMemorySourceRoot: fixture.sourceRepository,
    historySourceSha256: fixture.prehistorySha256,
    historySourcePath: fixture.prehistoryPath,
    materializeEvaluator: async () => {
      for (const [arm, path] of copiedAuthPaths) {
        if (await Bun.file(path).exists()) {
          throw new Error(
            `test observed ${arm} credential during evaluator materialization`,
          );
        }
      }
      options.sequence?.push("materialize-evaluator");
      await mkdir(fixture.evaluatorRoot);
      await Promise.all([
        writeFile(
          join(fixture.evaluatorRoot, "fail-to-pass.ts"),
          options.corruptEvaluator
            ? `${fixture.failToPassBytes}// drift\n`
            : fixture.failToPassBytes,
          { encoding: "utf8", flag: "wx" },
        ),
        writeFile(
          join(fixture.evaluatorRoot, "pass-to-pass.ts"),
          fixture.passToPassBytes,
          { encoding: "utf8", flag: "wx" },
        ),
      ]);
    },
    materializePrehistory: async () => {
      options.sequence?.push("materialize-prehistory");
      await writeFile(fixture.prehistoryPath, fixture.prehistoryBytes, {
        encoding: "utf8",
        flag: "wx",
      });
    },
    model: "gpt-5.6-sol",
    npmExecutable: "/fake/npm",
    outputDirectory,
    packageTarball: fixture.packageTarball,
    passToPassSource: fixture.passToPassBytes,
    passToPassCommand: [process.execPath, "{evaluatorRoot}/pass-to-pass.ts"],
    prompt: "Create deterministic-result.txt for the current C3 task.",
    reasoningEffort: "xhigh",
    repetition: 1,
    runId: suffix,
    runtimeRoot: join(fixture.root, `${suffix}-runtime`),
    seed: 1,
    sourceRepository: fixture.sourceRepository,
    stageId: "stage-2",
    stageTimeoutMs: 2_000,
    testTimeoutMs: 2_000,
    visibleBaseHealthCommand: [process.execPath, "-e", "process.exit(0)"],
    workspaceRoot: join(fixture.root, `${suffix}-workspaces`),
    dependencies: {
      auditPermissionIsolation: async ({ deniedReadPaths, phase, runtime }) => {
        options.auditedDeniedReadPaths?.push({
          arm: runtime.plan.arm,
          paths: deniedReadPaths,
          phase,
        });
        const failureArm = options.preLaunchPermissionFailureArm ??
          (options.preLaunchPermissionFailure
            ? "goodmemory-installed"
            : undefined);
        if (
          phase === "pre-launch" &&
          runtime.plan.arm === failureArm
        ) {
          throw new Error("injected pre-launch permission drift");
        }
        return permissionIsolation(
          phase,
          runtime.plan.arm === "goodmemory-installed" &&
              phase !== "preflight"
            ? C3_INSTALLED_DENIED_READ_LABELS
            : C3_BASE_DENIED_READ_LABELS,
        );
      },
      cleanupRuntime: async () => undefined,
      collectBaseHealth: async ({ workspace }) => {
        options.sequence?.push("base-health");
        const evidence = await runC3BaseHealthProbe({
          bunExecutable: process.execPath,
          expectedCommit: fixture.commit,
          expectedFailToPassOutputFragments: ["C3_EXPECTED_BASE_FAILURE"],
          failToPassSource: fixture.failToPassBytes,
          passToPassSource: fixture.passToPassBytes,
          visibleCommand: [process.execPath, "-e", "process.exit(0)"],
          workspace,
        });
        return options.baseHealthFailure
          ? {
              ...evidence,
              passed: false,
              reasons: ["injected base-health failure"],
            }
          : evidence;
      },
      collectHostConfigurations: async () => buildC3HostConfigurationEvidence({
        goodmemoryInstalled: {
          codexConfig: {
            normalizedText: 'hooks = true\nmemories = false\n',
            sourceSha256: SHA256,
          },
          environment: { GOODMEMORY_HOME: "<home>" },
          goodmemoryConfig: {
            normalizedText: '{"retrievalProfile":"coding_agent"}\n',
            sourceSha256: SHA256,
          },
          hooksConfig: {
            normalizedText: '{"hooks":true}\n',
            sourceSha256: SHA256,
          },
          profile: {
            activationMode: "global",
            hookRegistered: true,
            mcpRegistered: true,
            persistRawTranscript: false,
            retrievalProfile: "coding_agent",
            workspaceStatus: "ok",
            writebackMode: "selective",
          },
        },
        noMemory: {
          codexConfig: {
            normalizedText: 'hooks = false\nmemories = false\n',
            sourceSha256: SHA256,
          },
          environment: {},
          goodmemoryConfig: null,
          hooksConfig: null,
          profile: null,
        },
      }),
      collectHostPreflight: async ({
        baseHealth,
        hostConfigurationsBytes,
        installedRuntime,
        noMemoryRuntime,
      }) => {
        if (options.hostPreflightFailure) {
          throw new Error("injected host-preflight failure");
        }
        return hostPreflightEvidence(
          fixture.commit,
          baseHealth.noMemory.tree,
          sha256(hostConfigurationsBytes),
          installedRuntime,
          noMemoryRuntime,
        );
      },
      collectInstalledCanary: async ({ seed, runtime }) => ({
        expectedMemoryIds: seed.receipt.writtenMemoryIds,
        failureStage: options.canaryFailure
          ? "goodmemory-injection"
          : null,
        injectedExpectedMemoryIds: options.canaryFailure
          ? []
          : seed.receipt.writtenMemoryIds,
        passed: !options.canaryFailure,
        rawTranscriptPersisted: false,
        reasons: options.canaryFailure
          ? ["expected frozen-prehistory memory was not injected"]
          : [],
        sessionDigest: "session:installed",
        stateEvidenceSha256: SHA256,
        stopCursorAdvanced: true,
        terminalWritebackStatuses: ["committed"],
        threadId: "thread-installed",
        transcriptSourceSha256: runtime.package.sha256,
      }),
      collectSourceProvenance: async ({ repositoryRoot } = {}) => {
        options.sourceProvenanceRoots?.push(repositoryRoot);
        const sourceStateArtifactBytes = `${JSON.stringify({
          dirty: false,
          schemaVersion: 1,
          statusBytes: 0,
          statusSha256: sha256(""),
          trackedDiffBytes: 0,
          trackedDiffSha256: sha256(""),
          untrackedFiles: [],
        }, null, 2)}\n`;
        const sourceStateSha256 = sha256(sourceStateArtifactBytes);
        return {
          dirtyStateArtifactBytes: sourceStateArtifactBytes,
          provenance: {
            commit: "b".repeat(40),
            dirty: false,
            dirtyStateBytes: Buffer.byteLength(sourceStateArtifactBytes),
            dirtyStateSha256: sourceStateSha256,
            sourceStateBytes: Buffer.byteLength(sourceStateArtifactBytes),
            sourceStateSha256,
            statusSha256: sha256(""),
            trackedDiffSha256: sha256(""),
            tree: "c".repeat(40),
            untrackedFiles: [],
          },
          sourceStateArtifactBytes,
        };
      },
      prepareEvaluatorSandbox: async (input) => {
        const sandboxName = basename(input.sandboxRoot);
        if (
          sandboxName !== "goodmemory-installed" &&
          sandboxName !== "no-memory"
        ) {
          throw new Error("test evaluator sandbox received an unknown workspace");
        }
        const arm = sandboxName;
        if (
          input.evaluationWorkspace !== join(input.sandboxRoot, "workspace")
        ) {
          throw new Error("test evaluator workspace escaped its sandbox root");
        }
        options.sequence?.push(`sandbox:${arm}`);
        const evaluatorRoot = join(input.sandboxRoot, "evaluator");
        await mkdir(input.sandboxRoot, { recursive: true });
        await cp(input.evaluatorRoot, evaluatorRoot, { recursive: true });
        if (options.corruptSandboxEvaluatorArm === arm) {
          await writeFile(
            join(evaluatorRoot, fixture.evaluatorFiles[0]!.relativePath),
            "tampered evaluator\n",
          );
        }
        const configSha256 = buildCodexEvaluatorSandboxConfigSha256({
          deniedReadPaths: [
            input.authFile,
            input.evaluatorRoot,
            ...(input.deniedReadPaths ?? []),
          ],
          evaluationWorkspace: input.evaluationWorkspace,
          evaluatorRoot,
          profileName: "c3-evaluator",
          sandboxRoot: input.sandboxRoot,
        });
        return {
          evidence: {
            configSha256: options.sandboxConfigDriftArm === arm
              ? "f".repeat(64)
              : configSha256,
            configWriteDenied: true,
            copiedAuthRemovedBeforeEvaluator: true,
            evaluatorRead: true,
            evaluatorWriteDenied: true,
            networkAccess: false,
            networkDenied: true,
            networkPositiveControl:
              options.missingNetworkPositiveControlArm === arm
                ? false as true
                : true,
            originalAuthAliasDenied: true,
            originalAuthDenied: true,
            profileName: "c3-evaluator",
            schemaVersion: 1,
            workspaceRead: true,
            workspaceWrite: true,
          },
          evaluatorRoot,
          runProcess: async (request) => {
            if (options.evaluatorProcessCount !== undefined) {
              options.evaluatorProcessCount.value += 1;
            }
            if (!request.args.some((arg) => arg.includes(evaluatorRoot))) {
              throw new Error(
                "test evaluator command did not use the canonical evaluator root",
              );
            }
            options.evaluatorRootsUsed?.push(evaluatorRoot);
            return runBoundaryProcess(request);
          },
        };
      },
      prepareInstalled: async ({ permissionDeniedReadPaths, plan }) => {
        options.preparedDeniedReadPaths?.set(
          "goodmemory-installed",
          permissionDeniedReadPaths ?? [],
        );
        const authPath = join(plan.paths.codexHome, "auth.json");
        await mkdir(plan.paths.codexHome, { recursive: true });
        await writeFile(authPath, "{}\n", "utf8");
        copiedAuthPaths.set("goodmemory-installed", authPath);
        return {
          codex: {
            executable: "/fake/codex",
            executableSha256: SHA256,
            hooksEnabled: true,
            version: "codex-cli 0.144.3",
          },
          env: { C3_ARM: "goodmemory-installed", PATH: process.env.PATH ?? "" },
          goodmemoryExecutable: "/fake/goodmemory",
          instructionSha256,
          package: { sha256: SHA256, version: "0.5.1" },
          permissionProfile: permissionProfile(),
          plan,
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
          storagePath: "/fake/memory.sqlite",
        } satisfies C3InstalledArmRuntime;
      },
      prepareNoMemory: async ({ permissionDeniedReadPaths, plan }) => {
        options.preparedDeniedReadPaths?.set(
          "no-memory",
          permissionDeniedReadPaths ?? [],
        );
        const authPath = join(plan.paths.codexHome, "auth.json");
        await mkdir(plan.paths.codexHome, { recursive: true });
        await writeFile(authPath, "{}\n", "utf8");
        copiedAuthPaths.set("no-memory", authPath);
        return {
          codex: {
            executable: "/fake/codex",
            executableSha256: SHA256,
            version: "codex-cli 0.144.3",
          },
          env: { C3_ARM: "no-memory", PATH: process.env.PATH ?? "" },
          instructionSha256,
          isolation: {
            codexHomeEntryNames: ["auth.json", "config.toml"],
            goodMemoryFileCount: 0,
            hookConfigPresent: false,
            mcpConfigPresent: false,
            passed: true,
            preexistingSessionCount: 0,
            reasons: [],
          },
          permissionProfile: permissionProfile(),
          plan,
        } satisfies C3NoMemoryArmRuntime;
      },
      preflightInstalledRecall: async ({ seed }) => {
        options.sequence?.push("preflight-recall");
        if (options.recallPreflightThrow) {
          throw new Error("injected preflight boundary failure");
        }
        if (options.recallPreflightFailure) {
          return {
            expectedMemoryIds: [...seed.receipt.writtenMemoryIds],
            injectedMemoryIds: [],
            outputSha256: SHA256,
            passed: false,
            reason: "frozen prehistory is not retrievable before Codex execution",
            schemaVersion: 1,
            stateSha256: SHA256,
          };
        }
        return recallPreflight(seed.receipt.writtenMemoryIds);
      },
      runCodex: async (request) => {
        options.sequence?.push(`codex:${request.env?.C3_ARM ?? "unknown"}`);
        if (
          options.noMemoryLaunchFailure &&
          request.env?.C3_ARM === "no-memory"
        ) {
          return {
            durationMs: 1,
            events: [],
            exitCode: null,
            normalized: null,
            status: "spawn-failed",
            stderr: "failed to launch",
            stdout: "",
            timedOut: false,
          };
        }
        return fakeCodexRun(request);
      },
      removeModelCredential: async (runtime) => {
        options.sequence?.push(`credential:${runtime.plan.arm}`);
        if (options.leaveCopiedCredentialArm === runtime.plan.arm) {
          const path = join(runtime.plan.paths.codexHome, "auth.json");
          return {
            arm: runtime.plan.arm,
            auth: {
              label: `${runtime.plan.arm}-copied-auth`,
              path,
              pathSha256: sha256(path),
            },
            copiedAuthRemovedBeforeEvaluator: true,
            phase: "after-both-codex-before-evaluator-materialization",
            schemaVersion: 1,
          };
        }
        return removeC3ArmModelCredential(runtime);
      },
      seedInstalled: async ({ artifact, receiptPath }) => {
        options.sequence?.push("seed-installed");
        await options.onSeed?.(outputDirectory);
        const receipt = {
          historySourceSha256: artifact.sourceSha256,
          memoryExportSha256: SHA256,
          rawTranscriptPersisted: false as const,
          schemaVersion: 1 as const,
          seedSurface: "codex-writeback-from-rollout" as const,
          sourceSessionDigest: "session:prehistory",
          writebackOutcome: "written" as const,
          writtenMemoryIds: ["memory-001"],
        };
        await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
        return {
          exportLeakageAudit: {
            declaredForbiddenSourceSha256: [],
            overlaps: [],
            passed: true,
            sourceSha256: SHA256,
          },
          receipt,
        };
      },
    },
  });
}

const SHA256 = "a".repeat(64);

function permissionProfile() {
  return {
    configSha256: SHA256,
    filesystemDefault: "deny" as const,
    minimalRead: true as const,
    name: "c3-task" as const,
    networkAccess: false as const,
    workspaceWrite: true as const,
  };
}

function permissionIsolation(
  phase: "pre-launch" | "pre-seed" | "preflight" = "preflight",
  labels: readonly string[] = C3_BASE_DENIED_READ_LABELS,
): C3PermissionIsolationEvidence {
  const audit = {
    configSha256: SHA256,
    deniedReads: [...labels].sort().map((label) => {
      const path = `/fake/denied/${label}`;
      return {
        denied: true as const,
        exitCode: 1,
        label,
        path,
        pathSha256: sha256(path),
      };
    }),
    networkAccess: false as const,
    networkDenied: true as const,
    networkPositiveControl: true as const,
    passed: true as const,
    phase,
    profileName: "c3-task" as const,
    reasons: [],
    schemaVersion: 1 as const,
    workspaceRead: true as const,
    workspaceWrite: true as const,
  };
  return {
    audit,
    evidenceSha256: sha256(`${JSON.stringify(audit, null, 2)}\n`),
  };
}

function recallPreflight(memoryIds: readonly string[]) {
  return {
    expectedMemoryIds: [...memoryIds],
    injectedMemoryIds: [...memoryIds],
    outputSha256: SHA256,
    passed: true as const,
    schemaVersion: 1 as const,
    stateSha256: SHA256,
  };
}

function hostPreflightEvidence(
  commit: string,
  tree: string,
  hostConfigurationsSha256: string,
  installedRuntime: C3InstalledArmRuntime,
  noMemoryRuntime: C3BaselineArmRuntime,
): C3HostPreflightEvidence {
  const tool = (name: string) => ({
    executablePath: `/fake/${name}`,
    sha256: SHA256,
    version: `${name} test`,
  });
  return {
    codex: {
      executablePath: "/fake/codex",
      executableSha256: SHA256,
      features: {
        goodmemoryInstalled: {
          hooks: { enabled: true, maturity: "stable" },
          memories: { enabled: false, maturity: "experimental" },
          outputSha256: sha256(
            "hooks stable true\nmemories experimental false\n",
          ),
          rawOutput: "hooks stable true\nmemories experimental false\n",
        },
        noMemory: {
          hooks: { enabled: false, maturity: "stable" },
          memories: { enabled: false, maturity: "experimental" },
          outputSha256: sha256(
            "hooks stable false\nmemories experimental false\n",
          ),
          rawOutput: "hooks stable false\nmemories experimental false\n",
        },
      },
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      version: "codex-cli 0.144.3",
    },
    goodmemory: {
      configSha256: SHA256,
      executablePath: "/fake/goodmemory",
      executableSha256: SHA256,
      hooksSha256: SHA256,
      mcpExecutablePath: "/fake/goodmemory-mcp",
      mcpExecutableSha256: SHA256,
      packageSha256: SHA256,
      version: "0.5.1",
    },
    hostConfigurationsSha256,
    networkMode: "disabled" as const,
    paths: {
      goodmemoryInstalled: {
        codexHome: installedRuntime.plan.paths.codexHome,
        home: installedRuntime.plan.paths.home,
        result: installedRuntime.plan.paths.result,
        runtime: installedRuntime.plan.paths.armRoot,
        workspace: installedRuntime.plan.paths.workspace,
      },
      noMemory: {
        codexHome: noMemoryRuntime.plan.paths.codexHome,
        home: noMemoryRuntime.plan.paths.home,
        result: noMemoryRuntime.plan.paths.result,
        runtime: noMemoryRuntime.plan.paths.armRoot,
        workspace: noMemoryRuntime.plan.paths.workspace,
      },
    },
    platform: {
      arch: "arm64",
      cpuCount: 10,
      name: "darwin",
      totalMemoryBytes: 32_000_000_000,
    },
    repository: {
      commit,
      dirtyStatePolicy: "reject" as const,
      tree,
    },
    schemaVersion: 1 as const,
    toolchain: {
      bun: tool("bun"),
      git: tool("git"),
      node: tool("node"),
      npm: tool("npm"),
      python: tool("python"),
    },
  };
}

async function fakeCodexRun(request: CodexRunRequest): Promise<CodexRunResult> {
  const arm = request.env?.C3_ARM;
  await writeFile(
    join(request.cwd, "deterministic-result.txt"),
    arm === "goodmemory-installed" ? "resolved\n" : "plausible-but-wrong\n",
    "utf8",
  );
  const threadId = arm === "goodmemory-installed"
    ? "thread-installed"
    : "thread-no-memory";
  return {
    durationMs: 1,
    events: [],
    exitCode: 0,
    normalized: {
      commands: [],
      fileChanges: [{
        kind: "add",
        path: "deterministic-result.txt",
        sourceEventIndex: 0,
      }],
      finalMessage: "done",
      finalMessageEventIndex: 1,
      threadId,
      threadStartedEventIndex: 0,
      usage: { cachedInputTokens: 0, inputTokens: 1, outputTokens: 1 },
      usageEventIndex: 2,
    },
    status: "completed",
    stderr: "",
    stdout: "{}\n",
    timedOut: false,
  };
}

async function readStageEvidence(directory: string): Promise<Array<{
  armEvidence: Record<string, unknown> & {
    arm: string;
    hostCanary?: Record<string, unknown>;
  };
}>> {
  const entries = await readdir(directory);
  return Promise.all(entries.map(async (entry) =>
    JSON.parse(await readFile(join(directory, entry), "utf8")) as {
      armEvidence: Record<string, unknown> & {
        arm: string;
        hostCanary?: Record<string, unknown>;
      };
    }
  ));
}

async function stageEvidencePaths(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => join(directory, entry));
}

async function cloneProjection(
  source: string,
  destination: string,
): Promise<string> {
  await cp(source, destination, { recursive: true });
  return destination;
}

async function findProjectedStage(
  projectionDirectory: string,
  arm: "goodmemory-installed" | "no-memory",
): Promise<string> {
  const manifest = await readProjectionJson(
    projectionDirectory,
    "projection-manifest.json",
  );
  for (const file of asObjectArray(manifest.files)) {
    const path = file.path;
    if (typeof path !== "string" || !path.startsWith("stage-evidence/")) {
      continue;
    }
    const stage = await readProjectionJson(projectionDirectory, path);
    if (asObject(stage.armEvidence).arm === arm) {
      return path;
    }
  }
  throw new Error(`missing projected stage for ${arm}`);
}

async function projectedStagePaths(
  projectionDirectory: string,
): Promise<string[]> {
  const manifest = await readProjectionJson(
    projectionDirectory,
    "projection-manifest.json",
  );
  return asObjectArray(manifest.files)
    .map((file) => file.path)
    .filter((path): path is string =>
      typeof path === "string" && path.startsWith("stage-evidence/")
    )
    .sort();
}

async function readProjectionJson(
  projectionDirectory: string,
  path: string,
): Promise<Record<string, unknown>> {
  return asObject(JSON.parse(await readFile(
    join(projectionDirectory, path),
    "utf8",
  )));
}

async function rewriteProjectionFiles(
  projectionDirectory: string,
  files: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [path, bytes] of files) {
    await writeFile(join(projectionDirectory, path), bytes, "utf8");
  }
  const manifest = await readProjectionJson(
    projectionDirectory,
    "projection-manifest.json",
  );
  const entries = asObjectArray(manifest.files);
  for (const [path, bytes] of files) {
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      throw new Error(`projection manifest is missing ${path}`);
    }
    entry.bytes = Buffer.byteLength(bytes);
    entry.sha256 = sha256(bytes);
  }
  const identityBytes = files.get("run-identity.json");
  if (identityBytes !== undefined) {
    manifest.projectionRunIdentitySha256 = sha256(identityBytes);
  }
  await writeFile(
    join(projectionDirectory, "projection-manifest.json"),
    jsonBytes(manifest),
    "utf8",
  );
}

async function verifyPairProjection(
  projectionDirectory: string,
  fixture: PairFixture,
) {
  return verifyC3Projection({
    projectionDirectory,
    replayFixture: async () => ({
      bunExecutable: process.execPath,
      cleanup: async () => undefined,
      evaluatorFiles: fixture.evaluatorFiles,
      evaluatorRoot: fixture.evaluatorRoot,
      expectedCommit: fixture.commit,
      expectedFailToPassOutputFragments: ["C3_EXPECTED_BASE_FAILURE"],
      failToPassCommand: [
        process.execPath,
        "{evaluatorRoot}/fail-to-pass.ts",
      ],
      failToPassSource: fixture.failToPassBytes,
      passToPassCommand: [
        process.execPath,
        "{evaluatorRoot}/pass-to-pass.ts",
      ],
      passToPassSource: fixture.passToPassBytes,
      sourceRepository: fixture.sourceRepository,
      visibleBaseHealthCommand: [
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
    }),
    testOnlyCollectVerifierSource:
      projectedRunnerSourceCollector(projectionDirectory),
  });
}

function projectedRunnerSourceCollector(
  projectionDirectory: string,
) {
  return async () => {
    const identity = await readProjectionJson(
      projectionDirectory,
      "run-identity.json",
    );
    const provenance = asObject(identity.runnerSource);
    const sourceStateArtifactBytes = await readFile(
      join(projectionDirectory, "runner-source-state.json"),
      "utf8",
    );
    return {
      dirtyStateArtifactBytes: sourceStateArtifactBytes,
      provenance: provenance as {
        commit: string;
        dirty: boolean;
        dirtyStateBytes: number;
        dirtyStateSha256: string;
        sourceStateBytes: number;
        sourceStateSha256: string;
        statusSha256: string;
        trackedDiffSha256: string;
        tree: string;
        untrackedFiles: Array<{
          bytes: number;
          path: string;
          sha256: string;
        }>;
      },
      sourceStateArtifactBytes,
    };
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error("expected object array");
  }
  return value.map(asObject);
}

function asStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("expected string array");
  }
  return value;
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function rewriteProjectedFile(
  projectionDirectory: string,
  relativePath: string,
  bytes: string,
): Promise<void> {
  const manifestPath = join(projectionDirectory, "projection-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    files: Array<{
      bytes: number;
      path: string;
      sha256: string;
    }>;
    projectionRunIdentitySha256: string;
  };
  const file = manifest.files.find((entry) => entry.path === relativePath);
  if (file === undefined) {
    throw new Error(`missing projected file: ${relativePath}`);
  }
  file.bytes = Buffer.byteLength(bytes);
  file.sha256 = sha256(bytes);
  if (relativePath === "run-identity.json") {
    manifest.projectionRunIdentitySha256 = file.sha256;
  }
  await Promise.all([
    writeFile(join(projectionDirectory, relativePath), bytes, "utf8"),
    writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
  ]);
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }
  return stdout;
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
