import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "bun:test";

import {
  C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
  C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256,
  assertNoC6InstalledHostPlacementContainerCandidates,
  buildC6InstalledHostPlacementDockerCreateCommand,
  claimC6InstalledHostPlacementContainer,
  materializeC6InstalledHostPlacementLinux,
  removeC6InstalledHostPlacementContainer,
  runC6InstalledHostPlacementWithCleanup,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-linux";
import type {
  C6InstalledHostPlacementCommandRunner,
  C6InstalledHostPlacementContainerExpectation,
  C6InstalledHostPlacementContainerOwnership,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-linux";

describe("Codex coding-effect C6 installed-host Linux placement runner", () => {
  it("builds one pinned network-none package-only container command", () => {
    const command = buildC6InstalledHostPlacementDockerCreateCommand({
      closureRoot: "/frozen/goodmemory-closure",
      codexFixtureRoot: "/frozen/codex-fixture",
      codexTarballRoot: "/frozen/codex-tarballs",
      containerName: "c6-placement-run-a",
      imageReference:
        `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
      ownershipNonce: "a".repeat(32),
      runId: "capture-1",
      runnerRoot: "/fresh/runner",
      workRoot: "/fresh/work",
    });

    expect(command).toEqual([
      "docker",
      "create",
      "--pull=never",
      "--name=c6-placement-run-a",
      "--platform=linux/amd64",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
      "--env=HOME=/work/home",
      "--env=LANG=C.UTF-8",
      "--env=NO_COLOR=1",
      `--label=org.goodmemory.c6.placement.owner=${"a".repeat(32)}`,
      "--label=org.goodmemory.c6.placement.run=capture-1",
      `--label=org.goodmemory.c6.placement.name-sha256=${sha256("c6-placement-run-a")}`,
      `--label=org.goodmemory.c6.placement.work-root-sha256=${sha256("/fresh/work")}`,
      "--mount=type=bind,src=/frozen/goodmemory-closure,dst=/closure,readonly",
      "--mount=type=bind,src=/frozen/codex-fixture,dst=/codex-fixture,readonly",
      "--mount=type=bind,src=/frozen/codex-tarballs,dst=/codex-tarballs,readonly",
      "--mount=type=bind,src=/fresh/runner,dst=/runner,readonly",
      "--mount=type=bind,src=/fresh/work,dst=/work",
      `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
      "/bin/sh",
      "/runner/run.sh",
    ]);
    expect(C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("rejects mutable image references and relative mount paths", () => {
    const base = {
      closureRoot: "/frozen/goodmemory-closure",
      codexFixtureRoot: "/frozen/codex-fixture",
      codexTarballRoot: "/frozen/codex-tarballs",
      containerName: "c6-placement-run-a",
      imageReference: "goodmemory-c6-runtime:latest",
      ownershipNonce: "a".repeat(32),
      runId: "capture-1",
      runnerRoot: "/fresh/runner",
      workRoot: "/fresh/work",
    };
    expect(() =>
      buildC6InstalledHostPlacementDockerCreateCommand(base)
    ).toThrow("pinned image");
    expect(() => buildC6InstalledHostPlacementDockerCreateCommand({
      ...base,
      closureRoot: "relative/closure",
      imageReference:
        `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
    })).toThrow("absolute");
  });

  it("rejects output/input overlap and preserves a pre-existing output", async () => {
    await expect(materializeC6InstalledHostPlacementLinux({
      closureRoot: "/frozen/closure",
      codexFixtureRoot: "/frozen/codex-fixture",
      codexTarballRoot: "/frozen/codex-tarballs",
      outputPath: "/frozen/closure/result.json",
    })).rejects.toThrow("overlaps");

    const root = await mkdtemp(join(tmpdir(), "c6-placement-output-"));
    const outputPath = join(root, "existing.json");
    await writeFile(outputPath, "keep-me\n");
    try {
      await expect(materializeC6InstalledHostPlacementLinux({
        closureRoot: join(root, "missing-closure"),
        codexFixtureRoot: join(root, "missing-fixture"),
        codexTarballRoot: join(root, "missing-tarballs"),
        outputPath,
      })).rejects.toThrow();
      expect(await readFile(outputPath, "utf8")).toBe("keep-me\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("ignores an unrelated create id and claims only the exact owned discovery", async () => {
    const ownership = placementOwnership();
    const unrelatedId = "b".repeat(64);
    const ownedId = "c".repeat(64);
    const removedIds: string[] = [];
    let discoveryCount = 0;
    const runner: C6InstalledHostPlacementCommandRunner = async (
      command,
    ) => {
      if (command[1] === "create") {
        return commandResult({ stdout: `${unrelatedId}\n` });
      }
      if (command[1] === "ps") {
        expect(command).toContain(
          `--filter=label=org.goodmemory.c6.placement.name-sha256=${sha256(ownership.containerName)}`,
        );
        expect(command).toContain(
          `--filter=label=org.goodmemory.c6.placement.work-root-sha256=${sha256(ownership.workRoot)}`,
        );
        discoveryCount += 1;
        return commandResult({
          stdout: discoveryCount === 1
            ? ""
            : `${unrelatedId}\n${ownedId}\n`,
        });
      }
      if (command[1] === "inspect") {
        const id = command[2]!;
        if (removedIds.includes(id)) {
          return commandResult({
            exitCode: 1,
            stderr: `Error: No such object: ${id}`,
          });
        }
        const expectation = { ...ownership, containerId: id };
        return commandResult({
          stdout: JSON.stringify([
            dockerInspect(
              expectation,
              id === ownedId ? {} : { name: "unrelated-container" },
            ),
          ]),
        });
      }
      if (command[1] === "rm") {
        removedIds.push(command[3]!);
        return commandResult();
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };

    const claimed = await claimC6InstalledHostPlacementContainer(
      ownership,
      runner,
    );
    expect(claimed.containerId).toBe(ownedId);
    await removeC6InstalledHostPlacementContainer(claimed, runner);
    expect(removedIds).toEqual([ownedId]);
  });

  it("cleans an exactly owned container when its isolation config drifted", async () => {
    const ownership = placementOwnership();
    const ownedId = "d".repeat(64);
    const removedIds: string[] = [];
    let discoveryCount = 0;
    const runner: C6InstalledHostPlacementCommandRunner = async (
      command,
    ) => {
      if (command[1] === "create") {
        return commandResult({ stdout: `${ownedId}\n` });
      }
      if (command[1] === "ps") {
        discoveryCount += 1;
        return commandResult({ stdout: "" });
      }
      if (command[1] === "inspect") {
        if (removedIds.includes(command[2]!)) {
          return commandResult({
            exitCode: 1,
            stderr: `Error: No such container: ${command[2]}`,
          });
        }
        return commandResult({
          stdout: JSON.stringify([
            dockerInspect(
              { ...ownership, containerId: ownedId },
              { networkMode: "bridge" },
            ),
          ]),
        });
      }
      if (command[1] === "rm") {
        removedIds.push(command[3]!);
        return commandResult();
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };

    await expect(claimC6InstalledHostPlacementContainer(
      ownership,
      runner,
    )).rejects.toThrow("isolation drifted");
    expect(discoveryCount).toBe(1);
    expect(removedIds).toEqual([ownedId]);
  });

  it("recovers an uncertain create by discovery and cleans only the exact owner", async () => {
    const ownership = placementOwnership();
    const unrelatedId = "e".repeat(64);
    const ownedId = "f".repeat(64);
    const removedIds: string[] = [];
    let discoveryCount = 0;
    const runner: C6InstalledHostPlacementCommandRunner = async (
      command,
    ) => {
      if (command[1] === "create") {
        throw new Error("simulated Docker CLI timeout");
      }
      if (command[1] === "ps") {
        discoveryCount += 1;
        return commandResult({
          stdout: discoveryCount === 1
            ? ""
            : `${unrelatedId}\n${ownedId}\n`,
        });
      }
      if (command[1] === "inspect") {
        const id = command[2]!;
        if (removedIds.includes(id)) {
          return commandResult({
            exitCode: 1,
            stderr: `Error: No such object: ${id}`,
          });
        }
        const expectation = { ...ownership, containerId: id };
        return commandResult({
          stdout: JSON.stringify([
            dockerInspect(
              expectation,
              id === ownedId
                ? { command: ["/bin/sh", "/wrong-runner.sh"] }
                : { name: "unrelated-container" },
            ),
          ]),
        });
      }
      if (command[1] === "rm") {
        removedIds.push(command[3]!);
        return commandResult();
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };

    await expect(claimC6InstalledHostPlacementContainer(
      ownership,
      runner,
    )).rejects.toThrow("isolation drifted");
    expect(removedIds).toEqual([ownedId]);
  });

  it("preserves an ownership-inspect failure without deleting the unproven id", async () => {
    const ownership = placementOwnership();
    const unprovenId = "9".repeat(64);
    let discoveryCount = 0;
    let removeCount = 0;
    const runner: C6InstalledHostPlacementCommandRunner = async (
      command,
    ) => {
      if (command[1] === "create") {
        return commandResult({ stdout: `${unprovenId}\n` });
      }
      if (command[1] === "ps") {
        discoveryCount += 1;
        return commandResult({
          stdout: discoveryCount === 1 ? "" : `${unprovenId}\n`,
        });
      }
      if (command[1] === "inspect") {
        throw new Error("SIMULATED_DOCKER_INSPECT_UNAVAILABLE");
      }
      if (command[1] === "rm") {
        removeCount += 1;
        return commandResult();
      }
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };

    await expect(claimC6InstalledHostPlacementContainer(
      ownership,
      runner,
    )).rejects.toThrow("SIMULATED_DOCKER_INSPECT_UNAVAILABLE");
    expect(discoveryCount).toBe(9);
    expect(removeCount).toBe(0);
  });

  it("retains both the primary and cleanup failures", async () => {
    const primary = new Error("SIMULATED_PRIMARY_FAILURE");
    const cleanup = new Error("SIMULATED_CLEANUP_FAILURE");
    let caught: unknown;
    try {
      await runC6InstalledHostPlacementWithCleanup(
        async () => {
          throw primary;
        },
        async () => {
          throw cleanup;
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      primary,
      cleanup,
    ]);
    expect((caught as Error).message).toContain(
      "execution and cleanup failed",
    );
  });

  it("never finalizes an artifact before cleanup succeeds", async () => {
    let finalized = false;
    await expect(runC6InstalledHostPlacementWithCleanup(
      async () => "artifact",
      async () => {
        throw new Error("SIMULATED_CLEANUP_FAILURE");
      },
      async () => {
        finalized = true;
      },
    )).rejects.toThrow("SIMULATED_CLEANUP_FAILURE");
    expect(finalized).toBe(false);

    expect(await runC6InstalledHostPlacementWithCleanup(
      async () => "artifact",
      async () => {},
      async () => {
        finalized = true;
      },
    )).toBe("artifact");
    expect(finalized).toBe(true);
  });

  it("refuses root cleanup while any attempted ownership candidate remains", async () => {
    const ownership = placementOwnership();
    const candidateId = "8".repeat(64);
    let commandCount = 0;
    const runner: C6InstalledHostPlacementCommandRunner = async (
      command,
    ) => {
      commandCount += 1;
      expect(command[1]).toBe("ps");
      expect(command).toContain(
        `--filter=label=org.goodmemory.c6.placement.owner=${ownership.ownershipNonce}`,
      );
      expect(command).toContain(
        `--filter=label=org.goodmemory.c6.placement.run=${ownership.runId}`,
      );
      expect(command).toContain(
        `--filter=label=org.goodmemory.c6.placement.name-sha256=${sha256(ownership.containerName)}`,
      );
      expect(command).toContain(
        `--filter=label=org.goodmemory.c6.placement.work-root-sha256=${sha256(ownership.workRoot)}`,
      );
      return commandResult({ stdout: `${candidateId}\n` });
    };

    await expect(
      assertNoC6InstalledHostPlacementContainerCandidates(
        [ownership],
        runner,
      ),
    ).rejects.toThrow("attempted ownership candidate remains");
    expect(commandCount).toBe(1);
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function placementOwnership(): C6InstalledHostPlacementContainerOwnership {
  return {
    closureRoot: "/frozen/goodmemory-closure",
    codexFixtureRoot: "/frozen/codex-fixture",
    codexTarballRoot: "/frozen/codex-tarballs",
    containerName: "c6-placement-run-a",
    ownershipNonce: "a".repeat(32),
    runId: "capture-1",
    runnerRoot: "/fresh/runner",
    workRoot: "/fresh/work",
  };
}

function commandResult(
  overrides: Partial<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }> = {},
): { exitCode: number; stderr: string; stdout: string } {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
    ...overrides,
  };
}

function dockerInspect(
  expected: C6InstalledHostPlacementContainerExpectation,
  drift: {
    command?: string[];
    name?: string;
    networkMode?: string;
  } = {},
): Record<string, unknown> {
  return {
    Config: {
      Cmd: drift.command ?? ["/bin/sh", "/runner/run.sh"],
      Env: [
        "HOME=/work/home",
        "LANG=C.UTF-8",
        "NO_COLOR=1",
      ],
      Image: `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
      Labels: {
        "org.goodmemory.c6.placement.name-sha256":
          sha256(expected.containerName),
        "org.goodmemory.c6.placement.owner":
          expected.ownershipNonce,
        "org.goodmemory.c6.placement.run": expected.runId,
        "org.goodmemory.c6.placement.work-root-sha256":
          sha256(expected.workRoot),
      },
    },
    HostConfig: {
      CapDrop: ["ALL"],
      NetworkMode: drift.networkMode ?? "none",
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges"],
    },
    Id: expected.containerId,
    Mounts: [
      dockerMount(expected.closureRoot, "/closure", false),
      dockerMount(
        expected.codexFixtureRoot,
        "/codex-fixture",
        false,
      ),
      dockerMount(
        expected.codexTarballRoot,
        "/codex-tarballs",
        false,
      ),
      dockerMount(expected.runnerRoot, "/runner", false),
      dockerMount(expected.workRoot, "/work", true),
    ],
    Name: `/${drift.name ?? expected.containerName}`,
    State: {
      ExitCode: 0,
      Status: "created",
    },
  };
}

function dockerMount(
  source: string,
  destination: string,
  rw: boolean,
): Record<string, unknown> {
  return {
    Destination: destination,
    RW: rw,
    Source: source,
    Type: "bind",
  };
}
