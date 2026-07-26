import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import {
  C6_CODEX_RUNTIME_LINUX_NPM_CACHE_ADD_COMMANDS,
  C6_CODEX_RUNTIME_LINUX_NPM_CI_COMMAND,
  buildC6CodexRuntimeLinuxDockerCreateCommand,
  materializeC6CodexRuntimeLinux,
  parseC6CodexRuntimeLinuxCreatedContainerId,
  verifyC6CodexRuntimeLinuxMaterialization,
} from "../../scripts/codex-coding-effect/c6-codex-runtime-linux";
import type {
  C6CodexRuntimeLinuxCommandInput,
  C6CodexRuntimeLinuxCommandResult,
  C6CodexRuntimeLinuxMaterializerInput,
} from "../../scripts/codex-coding-effect/c6-codex-runtime-linux";

const IMAGE_SHA256 = "1".repeat(64);
const IMAGE_REFERENCE = `sha256:${IMAGE_SHA256}`;
const gzipAsync = promisify(gzip);

describe("Codex coding-effect C6 Codex Linux runtime materializer", () => {
  it("builds an owned, network-disabled, read-only Linux amd64 container", () => {
    const command = buildC6CodexRuntimeLinuxDockerCreateCommand({
      containerUser: "501:20",
      dockerCliPath: "/usr/bin/docker",
      expectedImageSha256: IMAGE_SHA256,
      fixtureRoot: "/tmp/c6-codex-fixture",
      imageReference: IMAGE_REFERENCE,
      name: "goodmemory-c6-codex-runtime-a-run-1",
      ownershipNonce: "a".repeat(32),
      run: 1,
      tarballRoot: "/tmp/c6-codex-tarballs",
      workRoot: "/tmp/c6-codex-work",
    });

    expect(command[0]).toBe("/usr/bin/docker");
    expect(command).toContain("--pull=never");
    expect(command).toContain("--platform=linux/amd64");
    expect(command).toContain("--network=none");
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      "--tmpfs=/tmp:rw,nosuid,nodev,size=268435456",
    );
    expect(command).toContain("--user=501:20");
    expect(command).toContain(
      "--env=NPM_CONFIG_GLOBALCONFIG=/work/config/global.npmrc",
    );
    expect(command).toContain(
      "--env=NPM_CONFIG_USERCONFIG=/work/config/user.npmrc",
    );
    expect(command).toContain(
      "--label=org.goodmemory.c6.codex-runtime.nonce=" +
        "a".repeat(32),
    );
    expect(command).toContain(
      "--label=org.goodmemory.c6.codex-runtime.run=1",
    );
    expect(
      command.filter((part) => part.startsWith("--mount=")),
    ).toEqual([
      "--mount=type=bind,src=/tmp/c6-codex-fixture,dst=/input/fixture,readonly",
      "--mount=type=bind,src=/tmp/c6-codex-tarballs,dst=/input/tarballs,readonly",
      "--mount=type=bind,src=/tmp/c6-codex-work,dst=/work",
    ]);
    expect(command.at(-2)).toBe(IMAGE_REFERENCE);
    expect(command.at(-1)).toBe("/work/run.sh");
    expect(C6_CODEX_RUNTIME_LINUX_NPM_CACHE_ADD_COMMANDS).toEqual([
      [
        "npm",
        "cache",
        "add",
        "/input/tarballs/openai-codex-0.145.0.tgz",
        "--cache",
        "/work/cache",
      ],
      [
        "npm",
        "cache",
        "add",
        "/input/tarballs/openai-codex-0.145.0-linux-x64.tgz",
        "--cache",
        "/work/cache",
      ],
    ]);
    expect(C6_CODEX_RUNTIME_LINUX_NPM_CI_COMMAND).toContain("--offline");
    expect(C6_CODEX_RUNTIME_LINUX_NPM_CI_COMMAND).toContain(
      "--include=optional",
    );
    expect(parseC6CodexRuntimeLinuxCreatedContainerId(
      `${"a".repeat(64)}\n`,
    )).toBe("a".repeat(64));
    expect(() => parseC6CodexRuntimeLinuxCreatedContainerId(
      `${"a".repeat(12)}\n`,
    )).toThrow("full 64-character");
  });

  it("orchestrates two fresh owned runs and persists a structure-only receipt last", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      const written: string[] = [];
      const result = await materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
          testHooks: {
            artifactWritten: (path) => {
              written.push(path);
            },
          },
        },
      );

      expect(docker.calls.filter(
        (call) => call.command[1] === "create",
      )).toHaveLength(2);
      expect(docker.calls.filter(
        (call) => call.command[1] === "start",
      )).toHaveLength(2);
      expect(docker.calls.filter(
        (call) => call.command[1] === "rm",
      )).toHaveLength(2);
      const createNames = docker.calls
        .filter((call) => call.command[1] === "create")
        .map((call) =>
          call.command.find((part) => part.startsWith("--name="))
        );
      expect(new Set(createNames).size).toBe(2);
      expect(written.at(-1)).toBe("receipt.json");
      expect(result).toMatchObject({
        codexRunReady: false,
        executionMode: "injected-command-seam",
        liveLinuxOfflineInstallObserved: false,
        persistedLinuxOfflineInstallProven: false,
        persistedReceiptValidation:
          "frozen-runner-receipt-structure-only",
      });

      const [first, second] = await Promise.all([
        readFile(join(
          fixture.input.outputRoot,
          "artifacts",
          "run-1.json",
        )),
        readFile(join(
          fixture.input.outputRoot,
          "artifacts",
          "run-2.json",
        )),
      ]);
      expect(first.equals(second)).toBeTrue();
      const manifest = JSON.parse(await readFile(
        result.manifestPath,
        "utf8",
      )) as {
        packagePayload: {
          binCodex: { target: string };
          executables: Record<string, { mode: number }>;
          packageManifests: Record<string, { mode: number }>;
        };
        runnerClosureSha256?: string;
        runnerSourceSnapshotSha256: string;
      };
      expect(Object.values(
        manifest.packagePayload.executables,
      )).toHaveLength(6);
      expect(Object.values(
        manifest.packagePayload.executables,
      ).every((file) => file.mode === 0o755)).toBeTrue();
      expect(manifest.packagePayload.binCodex.target).toBe(
        "../@openai/codex/bin/codex.js",
      );
      expect(Object.values(
        manifest.packagePayload.packageManifests,
      ).every((file) => file.mode === 0o644)).toBeTrue();
      expect(manifest.runnerSourceSnapshotSha256).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(manifest.runnerClosureSha256).toBeUndefined();
      const verified = await verifyC6CodexRuntimeLinuxMaterialization({
        dockerCliPath: fixture.input.dockerCliPath,
        expected: fixture.input.expected,
        expectedReceiptSha256: result.receiptSha256,
        fixtureRoot: fixture.input.fixtureRoot,
        outputRoot: fixture.input.outputRoot,
        runtimeIdentityPath: fixture.input.runtimeIdentityPath,
        tarballRoot: fixture.input.tarballRoot,
      });
      expect(verified).toMatchObject({
        codexRunReady: false,
        linuxOfflineInstallProven: false,
        persistedReceiptValidation:
          "frozen-runner-receipt-structure-only",
        runCount: 2,
      });
      expect(await readdir(fixture.input.outputRoot)).toEqual([
        "artifacts",
        "receipt.json",
      ]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("uses a pinned Docker CLI and ignores ambient PATH and Docker endpoint mutation", async () => {
    const fixture = await createFixture();
    const ambient = {
      DOCKER_CERT_PATH: process.env.DOCKER_CERT_PATH,
      DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
      DOCKER_HOST: process.env.DOCKER_HOST,
      DOCKER_TLS_VERIFY: process.env.DOCKER_TLS_VERIFY,
      PATH: process.env.PATH,
    };
    try {
      const shimRoot = join(fixture.root, "path-shim");
      await mkdir(shimRoot);
      await writeFile(
        join(shimRoot, "docker"),
        "#!/bin/sh\nexit 99\n",
        { mode: 0o755 },
      );
      process.env.PATH = shimRoot;
      process.env.DOCKER_HOST = "tcp://attacker.invalid:2376";
      process.env.DOCKER_CONTEXT = "attacker";
      process.env.DOCKER_TLS_VERIFY = "1";
      process.env.DOCKER_CERT_PATH = join(fixture.root, "attacker-certs");

      const docker = createFakeDocker(fixture);
      const result = await materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      );
      for (const call of docker.calls) {
        expect(call.command[0]).toBe(fixture.input.dockerCliPath);
        expect(Object.keys(call.environment).sort()).toEqual([
          "DOCKER_CONFIG",
          "DOCKER_HOST",
          "HOME",
          "LANG",
          "LC_ALL",
          "PATH",
        ]);
        expect(call.environment.DOCKER_HOST).toBe(
          "unix:///var/run/docker.sock",
        );
        expect(call.environment.PATH).toBe("/usr/bin:/bin");
        expect(call.environment.DOCKER_CONTEXT).toBeUndefined();
        expect(call.environment.DOCKER_TLS_VERIFY).toBeUndefined();
        expect(call.environment.DOCKER_CERT_PATH).toBeUndefined();
      }
      const receipt = JSON.parse(await readFile(
        result.receiptPath,
        "utf8",
      )) as {
        dockerAuthority: {
          cliPath: string;
          cliSha256: string;
          daemonIdentityCryptographicallyAttested: boolean;
          daemonTrustBoundary: string;
          host: string;
        };
      };
      expect(receipt.dockerAuthority).toMatchObject({
        cliPath: fixture.input.dockerCliPath,
        cliSha256: fixture.input.expected.dockerCliSha256,
        daemonIdentityCryptographicallyAttested: false,
        daemonTrustBoundary:
          "explicit-unix-socket-daemon-not-cryptographically-attested",
        host: fixture.input.expected.dockerHost,
      });
    } finally {
      restoreEnvironment(ambient);
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects an unpinned Docker CLI before issuing Docker commands", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      await expect(materializeC6CodexRuntimeLinux(
        {
          ...fixture.input,
          expected: {
            ...fixture.input.expected,
            dockerCliSha256: "f".repeat(64),
          },
        },
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("Docker CLI identity does not match");
      expect(docker.calls).toHaveLength(0);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a Docker CLI symlink before issuing Docker commands", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      const dockerCliPath = join(fixture.root, "docker-link");
      await symlink(fixture.input.dockerCliPath, dockerCliPath);
      await expect(materializeC6CodexRuntimeLinux(
        {
          ...fixture.input,
          dockerCliPath,
        },
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("Docker CLI rejects symlink path components");
      expect(docker.calls).toHaveLength(0);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a non-executable Docker CLI before issuing Docker commands", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      await chmod(fixture.input.dockerCliPath, 0o644);
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("Docker CLI identity does not match");
      expect(docker.calls).toHaveLength(0);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects mutated, missing, and extra persisted artifacts", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      const result = await materializeC6CodexRuntimeLinux(fixture.input, {
        command: docker.command,
        nonce: nonceSequence(),
      });
      const verification = {
        dockerCliPath: fixture.input.dockerCliPath,
        expected: fixture.input.expected,
        expectedReceiptSha256: result.receiptSha256,
        fixtureRoot: fixture.input.fixtureRoot,
        outputRoot: fixture.input.outputRoot,
        runtimeIdentityPath: fixture.input.runtimeIdentityPath,
        tarballRoot: fixture.input.tarballRoot,
      };
      const runPath = join(
        fixture.input.outputRoot,
        "artifacts",
        "run-1.json",
      );
      const runBytes = await readFile(runPath);
      await writeFile(runPath, "{}\n");
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).rejects.toThrow();
      await writeFile(runPath, runBytes);

      const runnerPath = join(
        fixture.input.outputRoot,
        "artifacts",
        "runner-sources",
        "c6-codex-runtime-linux.ts",
      );
      const runnerBytes = await readFile(runnerPath);
      await writeFile(runnerPath, "mutated\n");
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).rejects.toThrow();
      await writeFile(runnerPath, runnerBytes);

      const manifestPath = join(
        fixture.input.outputRoot,
        "artifacts",
        "manifest.json",
      );
      const savedManifestPath = join(fixture.root, "manifest.saved");
      await rename(manifestPath, savedManifestPath);
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).rejects.toThrow();
      await rename(savedManifestPath, manifestPath);

      const extraPath = join(
        fixture.input.outputRoot,
        "artifacts",
        "extra.json",
      );
      await writeFile(extraPath, "{}\n");
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).rejects.toThrow("closure is not exact");
      await rm(extraPath);
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).resolves.toMatchObject({ runCount: 2 });

      const receiptPath = join(
        fixture.input.outputRoot,
        "receipt.json",
      );
      const receiptBytes = await readFile(receiptPath);
      await writeFile(receiptPath, `${receiptBytes.toString("utf8")} `);
      await expect(
        verifyC6CodexRuntimeLinuxMaterialization(verification),
      ).rejects.toThrow("receipt hash does not match");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects two individually valid runs whose bytes differ", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        mutateObservation: (observation, run) => {
          if (run === 2) {
            mutateInstalledTreeMode(observation);
          }
        },
      });
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("fresh runs are not byte-identical");
      expect(await pathExists(fixture.input.outputRoot)).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects two identical internally consistent but tarball-wrong executable identities", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        mutateObservation: (observation) => {
          const artifact = observation as {
            executables: {
              nativeCodex: { path: string; sha256: string };
            };
            installedTree: {
              entries: Array<{ path: string; sha256?: string }>;
              sha256: string;
            };
          };
          const wrong = "9".repeat(64);
          artifact.executables.nativeCodex.sha256 = wrong;
          const treeEntry = artifact.installedTree.entries.find(
            (entry) =>
              entry.path === artifact.executables.nativeCodex.path,
          )!;
          treeEntry.sha256 = wrong;
          artifact.installedTree.sha256 = sha256(
            JSON.stringify(artifact.installedTree.entries),
          );
        },
      });
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow(
        "tarball-derived package payload identity drifted",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects two identical internally consistent but tarball-wrong package manifests", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        mutateObservation: (observation) => {
          const artifact = observation as {
            installedTree: {
              entries: Array<{ mode: number; path: string }>;
              sha256: string;
            };
            packageManifests: {
              main: { mode: number; path: string };
            };
          };
          artifact.packageManifests.main.mode = 0o600;
          const treeEntry = artifact.installedTree.entries.find(
            (entry) =>
              entry.path === artifact.packageManifests.main.path,
          )!;
          treeEntry.mode = 0o600;
          artifact.installedTree.sha256 = sha256(
            JSON.stringify(artifact.installedTree.entries),
          );
        },
      });
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow(
        "tarball-derived package payload identity drifted",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("does not create containers when the output root already exists", async () => {
    const fixture = await createFixture();
    try {
      await mkdir(fixture.input.outputRoot);
      const docker = createFakeDocker(fixture);
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("output root already exists");
      expect(docker.calls.some(
        (call) => call.command[1] === "create",
      )).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects reused container ownership nonces before either run", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: () => "a".repeat(32),
        },
      )).rejects.toThrow("ownership nonces must be unique");
      expect(docker.calls.some(
        (call) => call.command[1] === "create",
      )).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("does not delete a replacement output directory after inode drift", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      const displaced = `${fixture.input.outputRoot}-displaced`;
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
          testHooks: {
            beforePublish: async (outputRoot) => {
              await rename(outputRoot, displaced);
              await mkdir(outputRoot);
              await writeFile(
                join(outputRoot, "foreign-owner.txt"),
                "keep\n",
              );
            },
          },
        },
      )).rejects.toThrow("output root before publish drifted");
      expect(await readFile(
        join(fixture.input.outputRoot, "foreign-owner.txt"),
        "utf8",
      )).toBe("keep\n");
      expect(await pathExists(displaced)).toBeTrue();
      expect(await pathExists(
        `${fixture.input.outputRoot}.materialize.lock`,
      )).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("publishes the receipt last without overwriting a raced receipt", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture);
      const written: string[] = [];
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
          testHooks: {
            artifactWritten: (path) => {
              written.push(path);
            },
            beforeReceipt: async (outputRoot) => {
              await writeFile(
                join(outputRoot, "receipt.json"),
                "foreign\n",
                { flag: "wx" },
              );
            },
          },
        },
      )).rejects.toThrow(
        "refuses to replace artifact receipt.json",
      );
      expect(written).toEqual([
        "artifacts/run-1.json",
        "artifacts/run-2.json",
        "artifacts/runner-sources/c6-asset-lock.ts",
        "artifacts/runner-sources/materialize-codex-coding-effect-c6-codex-runtime-linux.ts",
        "artifacts/runner-sources/c6-codex-runtime-linux.ts",
        "artifacts/runner-sources/c6-codex-runtime.ts",
        "artifacts/manifest.json",
        "artifacts/asset-lock.json",
      ]);
      expect(await pathExists(fixture.input.outputRoot)).toBeFalse();
      expect(await pathExists(
        `${fixture.input.outputRoot}.materialize.lock`,
      )).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  for (const scenario of [
    {
      discoveryCount: 3,
      label: "Docker create failure",
      options: { createFailure: true },
      message: "synthetic create failure",
      removed: false,
      waitCount: 2,
    },
    {
      discoveryCount: 4,
      label: "Docker create failure after daemon acceptance",
      options: { createFailureWithContainer: true },
      message: "synthetic create failure after daemon acceptance",
      removed: true,
      waitCount: 3,
    },
    {
      discoveryCount: 4,
      label: "Docker create timeout after daemon acceptance",
      options: { createTimeoutWithContainer: true },
      message: "synthetic create timeout",
      removed: true,
      waitCount: 3,
    },
    {
      discoveryCount: 4,
      label: "short Docker create id",
      options: { invalidContainerId: true },
      message: "full 64-character",
      removed: true,
      waitCount: 3,
    },
  ] as const) {
    it(`discovers and safely handles uncertain ownership after ${scenario.label}`, async () => {
      const fixture = await createFixture();
      try {
        const docker = createFakeDocker(fixture, scenario.options);
        const waits: number[] = [];
        await expect(materializeC6CodexRuntimeLinux(
          fixture.input,
          {
            command: docker.command,
            nonce: nonceSequence(),
            quiescenceWait: async (milliseconds) => {
              waits.push(milliseconds);
            },
          },
        )).rejects.toThrow(scenario.message);
        expect(docker.calls.some(
          (call) => call.command[1] === "start",
        )).toBeFalse();
        expect(docker.calls.filter(
          (call) => call.command[1] === "ps",
        )).toHaveLength(scenario.discoveryCount);
        expect(waits).toEqual(
          Array.from({ length: scenario.waitCount }, () => 250),
        );
        const discovery = docker.calls.find(
          (call) => call.command[1] === "ps",
        )!;
        const filters = discovery.command.filter((argument) =>
          argument.startsWith("--filter=label=")
        );
        expect(filters).toHaveLength(3);
        expect(filters.some((filter) =>
          filter.includes("codex-runtime.nonce=")
        )).toBeTrue();
        expect(filters.some((filter) =>
          filter.includes("codex-runtime.run=")
        )).toBeTrue();
        expect(filters.some((filter) =>
          filter.includes("codex-runtime.work-root-sha256=")
        )).toBeTrue();
        expect(docker.calls.some(
          (call) => call.command[1] === "rm",
        )).toBe(scenario.removed);
        if (scenario.removed) {
          const discoveryIndex = docker.calls.indexOf(discovery);
          const removeIndex = docker.calls.findIndex(
            (call) => call.command[1] === "rm",
          );
          expect(docker.calls.slice(
            discoveryIndex + 1,
            removeIndex,
          ).some((call) => call.command[1] === "inspect")).toBeTrue();
        }
        for (const call of docker.calls.filter(
          (candidate) => candidate.command[1] === "rm",
        )) {
          expect(call.command.at(-1)).toMatch(/^[a-f0-9]{64}$/u);
        }
        expect(docker.calls.some((call) =>
          call.command.some((part) =>
            part.startsWith(
              "goodmemory-c6-codex-runtime-",
            ) &&
            call.command[1] !== "create"
          )
        )).toBeFalse();
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    });
  }

  it("removes a matching container that appears after an empty create-timeout discovery", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        createTimeoutWithContainer: true,
        lateContainerAfterEmptyDiscovery: true,
      });
      const waits: number[] = [];
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
          quiescenceWait: async (milliseconds) => {
            waits.push(milliseconds);
          },
        },
      )).rejects.toThrow("synthetic create timeout");
      const discoveries = docker.calls.filter(
        (call) => call.command[1] === "ps",
      );
      expect(discoveries).toHaveLength(5);
      expect(waits).toEqual([250, 250, 250, 250]);
      const remove = docker.calls.find(
        (call) => call.command[1] === "rm",
      );
      expect(remove?.command.at(-1)).toMatch(/^[a-f0-9]{64}$/u);
      const removeIndex = remove === undefined
        ? -1
        : docker.calls.indexOf(remove);
      expect(docker.calls.slice(0, removeIndex).some(
        (call) => call.command[1] === "inspect",
      )).toBeTrue();
      expect(docker.calls.slice(removeIndex + 1).some(
        (call) =>
          call.command[1] === "inspect" &&
          call.label === "Codex runtime Docker cleanup verification",
      )).toBeTrue();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("refuses cleanup when discovered container ownership does not match", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        ownershipMismatch: true,
      });
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("ownership inspect failed");
      expect(docker.calls.some(
        (call) => call.command[1] === "start",
      )).toBeFalse();
      expect(docker.calls.some(
        (call) => call.command[1] === "rm",
      )).toBeFalse();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("removes an owned container even when its security isolation fails", async () => {
    const fixture = await createFixture();
    try {
      const docker = createFakeDocker(fixture, {
        securityIsolationMismatch: true,
      });
      await expect(materializeC6CodexRuntimeLinux(
        fixture.input,
        {
          command: docker.command,
          nonce: nonceSequence(),
        },
      )).rejects.toThrow("security inspect failed");
      expect(docker.calls.some(
        (call) => call.command[1] === "start",
      )).toBeFalse();
      const remove = docker.calls.find(
        (call) => call.command[1] === "rm",
      );
      expect(remove?.command.at(-1)).toMatch(/^[a-f0-9]{64}$/u);
      expect(docker.calls.some(
        (call) =>
          call.command[1] === "inspect" &&
          call.label === "Codex runtime Docker cleanup verification",
      )).toBeTrue();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

interface TestFixture {
  input: C6CodexRuntimeLinuxMaterializerInput;
  observation: Record<PropertyKey, unknown>;
  root: string;
}

const PLATFORM_PACKAGES = [
  { cpu: "arm64", os: "darwin", suffix: "darwin-arm64" },
  { cpu: "x64", os: "darwin", suffix: "darwin-x64" },
  { cpu: "arm64", os: "linux", suffix: "linux-arm64" },
  { cpu: "x64", os: "linux", suffix: "linux-x64" },
  { cpu: "arm64", os: "win32", suffix: "win32-arm64" },
  { cpu: "x64", os: "win32", suffix: "win32-x64" },
] as const;
const TEST_EXECUTABLE_PATHS = {
  bwrap:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap",
  codeModeHost:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host",
  nativeCodex:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
  rg:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/rg",
  wrapperCodexJs: "node_modules/@openai/codex/bin/codex.js",
  zsh:
    "node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh",
} as const;

async function createFixture(): Promise<TestFixture> {
  const root = await realpath(await mkdtemp(join(
    await realpath(tmpdir()),
    "goodmemory-c6-codex-linux-",
  )));
  const fixtureRoot = join(root, "fixture");
  const tarballRoot = join(root, "tarballs");
  await Promise.all([mkdir(fixtureRoot), mkdir(tarballRoot)]);
  const executableBytes = Object.fromEntries(
    Object.keys(TEST_EXECUTABLE_PATHS).map((name) => [
      name,
      Buffer.from(`synthetic-${name}`),
    ]),
  ) as Record<keyof typeof TEST_EXECUTABLE_PATHS, Buffer>;
  const mainManifestBytes = Buffer.from(canonicalJson({
    bin: { codex: "bin/codex.js" },
    name: "@openai/codex",
    version: "0.145.0",
  }));
  const linuxManifestBytes = Buffer.from(canonicalJson({
    name: "@openai/codex",
    version: "0.145.0-linux-x64",
  }));
  const mainBytes = await buildTestTgz([{
    bytes: executableBytes.wrapperCodexJs,
    mode: 0o755,
    path: "package/bin/codex.js",
  }, {
    bytes: mainManifestBytes,
    mode: 0o644,
    path: "package/package.json",
  }]);
  const linuxBytes = await buildTestTgz([{
    bytes: linuxManifestBytes,
    mode: 0o644,
    path: "package/package.json",
  }, {
    bytes: executableBytes.nativeCodex,
    mode: 0o755,
    path:
      "package/vendor/x86_64-unknown-linux-musl/bin/codex",
  }, {
    bytes: executableBytes.codeModeHost,
    mode: 0o755,
    path:
      "package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host",
  }, {
    bytes: executableBytes.rg,
    mode: 0o755,
    path:
      "package/vendor/x86_64-unknown-linux-musl/codex-path/rg",
  }, {
    bytes: executableBytes.bwrap,
    mode: 0o755,
    path:
      "package/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap",
  }, {
    bytes: executableBytes.zsh,
    mode: 0o755,
    path:
      "package/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh",
  }]);
  const mainIntegrity = sha512Integrity(mainBytes);
  const linuxIntegrity = sha512Integrity(linuxBytes);
  const mainUrl =
    "https://registry.npmjs.org/@openai/codex/-/codex-0.145.0.tgz";
  const linuxUrl =
    "https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-linux-x64.tgz";
  const packageJson = {
    dependencies: { "@openai/codex": "0.145.0" },
    name: "goodmemory-c6-codex-runtime",
    private: true,
    version: "1.0.0",
  };
  const lock = {
    lockfileVersion: 3,
    name: "goodmemory-c6-codex-runtime",
    packages: {
      "": {
        dependencies: { "@openai/codex": "0.145.0" },
        name: "goodmemory-c6-codex-runtime",
        version: "1.0.0",
      },
      "node_modules/@openai/codex": {
        integrity: mainIntegrity,
        optionalDependencies: Object.fromEntries(
          PLATFORM_PACKAGES.map(({ suffix }) => [
            `@openai/codex-${suffix}`,
            `npm:@openai/codex@0.145.0-${suffix}`,
          ]),
        ),
        resolved: mainUrl,
        version: "0.145.0",
      },
      ...Object.fromEntries(PLATFORM_PACKAGES.map(({
        cpu,
        os,
        suffix,
      }) => [
        `node_modules/@openai/codex-${suffix}`,
        {
          cpu: [cpu],
          integrity: suffix === "linux-x64"
            ? linuxIntegrity
            : sha512Integrity(Buffer.from(suffix)),
          name: "@openai/codex",
          optional: true,
          os: [os],
          resolved:
            `https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-${suffix}.tgz`,
          version: `0.145.0-${suffix}`,
        },
      ])),
    },
    requires: true,
    version: "1.0.0",
  };
  const packageJsonBytes = canonicalJson(packageJson);
  const packageLockBytes = canonicalJson(lock);
  const capture = {
    capturedAt: "2026-07-25T17:13:47Z",
    captureBoundary:
      "npm-registry-metadata-and-tarball-bytes-no-independent-registry-receipt",
    packageLockSha256: sha256(packageLockBytes),
    packages: [{
      alias: "@openai/codex",
      attestationUrl:
        "https://registry.npmjs.org/-/npm/v1/attestations/@openai%2fcodex@0.145.0",
      byteLength: mainBytes.byteLength,
      filename: "openai-codex-0.145.0.tgz",
      integrity: mainIntegrity,
      name: "@openai/codex",
      npmShasum: sha1(mainBytes),
      sha256: sha256(mainBytes),
      tarballUrl: mainUrl,
      version: "0.145.0",
    }, {
      alias: "@openai/codex-linux-x64",
      attestationUrl:
        "https://registry.npmjs.org/-/npm/v1/attestations/@openai%2fcodex@0.145.0-linux-x64",
      byteLength: linuxBytes.byteLength,
      filename: "openai-codex-0.145.0-linux-x64.tgz",
      integrity: linuxIntegrity,
      name: "@openai/codex",
      npmShasum: sha1(linuxBytes),
      sha256: sha256(linuxBytes),
      tarballUrl: linuxUrl,
      version: "0.145.0-linux-x64",
    }],
    schemaVersion: 1,
  };
  const captureBytes = canonicalJson(capture);
  const runtime = {
    bun: {
      executableSha256: "2".repeat(64),
      version: "1.3.11",
    },
    node: {
      executableSha256: "3".repeat(64),
      version: "v22.14.0",
    },
    npm: {
      cliSha256: "4".repeat(64),
      launcherSha256: "4".repeat(64),
      version: "10.9.2",
    },
  };
  const runtimeBytes = canonicalJson(runtime);
  const runtimeIdentityPath = join(root, "runtime-identity.json");
  const dockerCliPath = join(root, "docker");
  const dockerCliBytes = Buffer.from("#!/bin/sh\nexit 1\n");
  await Promise.all([
    writeFile(join(fixtureRoot, "package.json"), packageJsonBytes),
    writeFile(join(fixtureRoot, "package-lock.json"), packageLockBytes),
    writeFile(join(fixtureRoot, "registry-capture.json"), captureBytes),
    writeFile(
      join(tarballRoot, "openai-codex-0.145.0.tgz"),
      mainBytes,
    ),
    writeFile(
      join(tarballRoot, "openai-codex-0.145.0-linux-x64.tgz"),
      linuxBytes,
    ),
    writeFile(runtimeIdentityPath, runtimeBytes),
    writeFile(dockerCliPath, dockerCliBytes, { mode: 0o755 }),
  ]);
  const input: C6CodexRuntimeLinuxMaterializerInput = {
    containerUser: "501:20",
    dockerCliPath,
    expected: {
      captureSha256: sha256(captureBytes),
      dockerCliSha256: sha256(dockerCliBytes),
      dockerHost: "unix:///var/run/docker.sock",
      imageSha256: IMAGE_SHA256,
      linuxTarballSha256: sha256(linuxBytes),
      mainTarballSha256: sha256(mainBytes),
      packageJsonSha256: sha256(packageJsonBytes),
      packageLockSha256: sha256(packageLockBytes),
      runtimeIdentitySha256: sha256(runtimeBytes),
      version: "0.145.0",
    },
    fixtureRoot,
    imageReference: IMAGE_REFERENCE,
    outputRoot: join(root, "output"),
    runtimeIdentityPath,
    tarballRoot,
  };
  return {
    input,
    observation: buildObservation(input, runtime, {
      executableBytes,
      linuxManifestBytes,
      mainManifestBytes,
    }),
    root,
  };
}

function buildObservation(
  input: C6CodexRuntimeLinuxMaterializerInput,
  runtime: Record<PropertyKey, unknown>,
  payload: {
    executableBytes: Record<
      keyof typeof TEST_EXECUTABLE_PATHS,
      Buffer
    >;
    linuxManifestBytes: Buffer;
    mainManifestBytes: Buffer;
  },
): Record<PropertyKey, unknown> {
  const executables = Object.fromEntries(
    Object.entries(TEST_EXECUTABLE_PATHS).map(([name, path]) => {
      const bytes =
        payload.executableBytes[
          name as keyof typeof TEST_EXECUTABLE_PATHS
        ];
      return [name, {
        bytes: bytes.byteLength,
        mode: 0o755,
        path,
        sha256: sha256(bytes),
      }];
    }),
  );
  const packageManifests = {
    linuxX64: {
      bytes: payload.linuxManifestBytes.byteLength,
      mode: 0o644,
      path: "node_modules/@openai/codex-linux-x64/package.json",
      sha256: sha256(payload.linuxManifestBytes),
    },
    main: {
      bytes: payload.mainManifestBytes.byteLength,
      mode: 0o644,
      path: "node_modules/@openai/codex/package.json",
      sha256: sha256(payload.mainManifestBytes),
    },
  };
  const entries = [
    ...Object.values(executables).map((file) => ({
      ...file,
      type: "file",
    })),
    ...Object.values(packageManifests).map((file) => ({
      ...file,
      type: "file",
    })),
    {
      mode: 0o777,
      path: "node_modules/.bin/codex",
      target: "../@openai/codex/bin/codex.js",
      type: "symlink",
    },
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    architecture: "x86_64",
    binCodex: {
      path: "node_modules/.bin/codex",
      target: "../@openai/codex/bin/codex.js",
      type: "symlink",
    },
    codexVersionOutput: "codex-cli 0.145.0",
    executables,
    installedPackages: [{
      location: "node_modules/@openai/codex",
      name: "@openai/codex",
      version: "0.145.0",
    }, {
      location: "node_modules/@openai/codex-linux-x64",
      name: "@openai/codex",
      version: "0.145.0-linux-x64",
    }],
    installedTree: {
      entries,
      sha256: sha256(JSON.stringify(entries)),
    },
    kind: "c6-codex-runtime-linux-run",
    operatingSystem: "Linux",
    packageLock: {
      afterSha256: input.expected.packageLockSha256,
      beforeSha256: input.expected.packageLockSha256,
      unchanged: true,
    },
    packageManifests,
    runtime,
    schemaVersion: 1,
  };
}

interface FakeDockerOptions {
  createFailure?: boolean;
  createFailureWithContainer?: boolean;
  createTimeoutWithContainer?: boolean;
  invalidContainerId?: boolean;
  lateContainerAfterEmptyDiscovery?: boolean;
  mutateObservation?: (
    observation: Record<PropertyKey, unknown>,
    run: 1 | 2,
  ) => void;
  ownershipMismatch?: boolean;
  securityIsolationMismatch?: boolean;
}

function createFakeDocker(
  fixture: TestFixture,
  options: FakeDockerOptions = {},
): {
  calls: C6CodexRuntimeLinuxCommandInput[];
  command: (
    input: C6CodexRuntimeLinuxCommandInput,
  ) => Promise<C6CodexRuntimeLinuxCommandResult>;
} {
  const calls: C6CodexRuntimeLinuxCommandInput[] = [];
  const containers = new Map<string, {
    inspect: Record<PropertyKey, unknown>;
    removed: boolean;
    run: 1 | 2;
    workRoot: string;
  }>();
  let created = 0;
  let discoveryCount = 0;
  return {
    calls,
    command: async (input) => {
      calls.push(input);
      const [, operation, ...args] = input.command;
      if (operation === "version") {
        return commandResult(0, "28.0.0\n");
      }
      if (operation === "image" && args[0] === "inspect") {
        return commandResult(0, JSON.stringify([{
          Architecture: "amd64",
          Id: IMAGE_REFERENCE,
          Os: "linux",
        }]));
      }
      if (operation === "create") {
        if (options.createFailure) {
          return commandResult(42, "", "synthetic create failure\n");
        }
        const id = (created === 0 ? "a" : "b").repeat(64);
        created += 1;
        const value = dockerCreateValues(input.command);
        const run = Number(
          value.labels["org.goodmemory.c6.codex-runtime.run"],
        ) as 1 | 2;
        if (options.ownershipMismatch) {
          value.labels["org.goodmemory.c6.codex-runtime.nonce"] =
            "f".repeat(32);
        }
        const workMount = value.mounts.find(
          (mount) => mount.Destination === "/work",
        )!;
        containers.set(id, {
          inspect: {
            Config: {
              Cmd: ["/work/run.sh"],
              Entrypoint: ["/bin/sh"],
              Env: value.environment,
              Labels: value.labels,
              User: value.user,
              WorkingDir: "/work",
            },
            HostConfig: {
              CapDrop: ["ALL"],
              NetworkMode: "none",
              ReadonlyRootfs: true,
              SecurityOpt: ["no-new-privileges"],
              Tmpfs: {
                "/tmp": "rw,nosuid,nodev,size=268435456",
              },
            },
            Id: id,
            Image: IMAGE_REFERENCE,
            Mounts: value.mounts,
            Name: `/${value.name}`,
            State: {
              ExitCode: 0,
              Running: false,
            },
          },
          removed: false,
          run,
          workRoot: workMount.Source,
        });
        if (options.securityIsolationMismatch) {
          const inspect = containers.get(id)!.inspect as {
            HostConfig: { NetworkMode: string };
          };
          inspect.HostConfig.NetworkMode = "bridge";
        }
        if (options.createTimeoutWithContainer) {
          throw new Error("synthetic create timeout");
        }
        if (options.createFailureWithContainer) {
          return commandResult(
            42,
            "",
            "synthetic create failure after daemon acceptance\n",
          );
        }
        if (options.invalidContainerId) {
          return commandResult(0, `${id.slice(0, 12)}\n`);
        }
        return commandResult(0, `${id}\n`);
      }
      if (operation === "ps") {
        discoveryCount += 1;
        if (
          options.lateContainerAfterEmptyDiscovery &&
          discoveryCount === 1
        ) {
          return commandResult(0, "");
        }
        const filters = args
          .filter((argument) => argument.startsWith("--filter=label="))
          .map((argument) =>
            splitOnce(
              argument.slice("--filter=label=".length),
              "=",
            )
          );
        const ids = [...containers.entries()]
          .filter(([, container]) => {
            if (container.removed) {
              return false;
            }
            const inspect = container.inspect as {
              Config: { Labels: Record<string, string> };
            };
            return filters.every(([name, value]) =>
              inspect.Config.Labels[name] === value
            );
          })
          .map(([id]) => id);
        return commandResult(
          0,
          ids.length === 0 ? "" : `${ids.join("\n")}\n`,
        );
      }
      const id = args.at(-1) ?? "";
      const container = containers.get(id);
      if (operation === "inspect") {
        if (container === undefined || container.removed) {
          return commandResult(1, "", `No such container: ${id}\n`);
        }
        return commandResult(0, JSON.stringify([container.inspect]));
      }
      if (operation === "start") {
        if (container === undefined || container.removed) {
          return commandResult(1, "", "No such container\n");
        }
        const observation = structuredClone(fixture.observation);
        options.mutateObservation?.(observation, container.run);
        await writeFile(
          join(container.workRoot, "observed.json"),
          canonicalJson(observation),
        );
        return commandResult(0, "completed\n");
      }
      if (operation === "rm") {
        if (container === undefined || container.removed) {
          return commandResult(1, "", "No such container\n");
        }
        container.removed = true;
        return commandResult(0, `${id}\n`);
      }
      throw new Error(`unexpected fake Docker command ${input.command}`);
    },
  };
}

function dockerCreateValues(command: readonly string[]) {
  const labels: Record<string, string> = {};
  const environment: string[] = [];
  const mounts: Array<{
    Destination: string;
    RW: boolean;
    Source: string;
    Type: "bind";
  }> = [];
  let name = "";
  let user = "";
  for (const part of command) {
    if (part.startsWith("--name=")) {
      name = part.slice("--name=".length);
    } else if (part.startsWith("--label=")) {
      const [key, value] = splitOnce(part.slice("--label=".length), "=");
      labels[key] = value;
    } else if (part.startsWith("--env=")) {
      environment.push(part.slice("--env=".length));
    } else if (part.startsWith("--user=")) {
      user = part.slice("--user=".length);
    } else if (part.startsWith("--mount=")) {
      const fields = new Map(
        part.slice("--mount=".length).split(",").map((field) =>
          splitOnce(field, "=")
        ),
      );
      mounts.push({
        Destination: fields.get("dst")!,
        RW: !fields.has("readonly"),
        Source: fields.get("src")!,
        Type: "bind",
      });
    }
  }
  return { environment, labels, mounts, name, user };
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  return index < 0
    ? [value, ""]
    : [value.slice(0, index), value.slice(index + separator.length)];
}

function nonceSequence(): () => string {
  let value = 0;
  return () => {
    value += 1;
    return String(value).repeat(32);
  };
}

function commandResult(
  exitCode: number,
  stdout = "",
  stderr = "",
): C6CodexRuntimeLinuxCommandResult {
  return { exitCode, stderr, stdout };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function mutateInstalledTreeMode(
  observation: Record<PropertyKey, unknown>,
): void {
  const artifact = observation as {
    installedTree: {
      entries: Array<{ mode: number }>;
      sha256: string;
    };
  };
  artifact.installedTree.entries[0].mode = 0o700;
  artifact.installedTree.sha256 = sha256(
    JSON.stringify(artifact.installedTree.entries),
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function restoreEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

async function buildTestTgz(entries: readonly {
  bytes: Buffer;
  mode: number;
  path: string;
}[]): Promise<Buffer> {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, "utf8");
    writeTarOctal(header, entry.mode, 100, 8);
    writeTarOctal(header, 0, 108, 8);
    writeTarOctal(header, 0, 116, 8);
    writeTarOctal(header, entry.bytes.byteLength, 124, 12);
    writeTarOctal(header, 0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar", 257, 5, "ascii");
    header[262] = 0;
    header.write("00", 263, 2, "ascii");
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    const checksumText = checksum.toString(8).padStart(6, "0");
    header.write(checksumText, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 32;
    blocks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
    if (padding > 0) {
      blocks.push(Buffer.alloc(padding));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.from(await gzipAsync(Buffer.concat(blocks)));
}

function writeTarOctal(
  buffer: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function sha1(value: Uint8Array): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}
