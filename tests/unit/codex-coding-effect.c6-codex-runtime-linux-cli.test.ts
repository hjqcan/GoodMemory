import { describe, expect, it } from "bun:test";

import {
  parseC6CodexRuntimeLinuxMaterializerCliOptions,
  runC6CodexRuntimeLinuxMaterializerCommand,
} from "../../scripts/materialize-codex-coding-effect-c6-codex-runtime-linux";
import type {
  C6CodexRuntimeLinuxMaterializerInput,
} from "../../scripts/codex-coding-effect/c6-codex-runtime-linux";

const HASH = "a".repeat(64);
const IMAGE_SHA256 = "b".repeat(64);

describe("C6 Codex Linux runtime materializer CLI", () => {
  it("maps the exact pinned CLI closure into the materializer", async () => {
    const args = requiredArgs();
    const options =
      parseC6CodexRuntimeLinuxMaterializerCliOptions(args);
    expect(options.version).toBe("0.145.0");

    let dispatched: C6CodexRuntimeLinuxMaterializerInput | undefined;
    const result = await runC6CodexRuntimeLinuxMaterializerCommand(
      args,
      async (input) => {
        dispatched = input;
        return { status: "dispatched" };
      },
    );
    expect(result).toEqual({ status: "dispatched" });
    expect(dispatched).toEqual({
      containerUser: "501:20",
      dockerCliPath: "/opt/docker/bin/docker",
      expected: {
        captureSha256: HASH,
        dockerCliSha256: HASH,
        dockerHost: "unix:///var/run/docker.sock",
        imageSha256: IMAGE_SHA256,
        linuxTarballSha256: HASH,
        mainTarballSha256: HASH,
        packageJsonSha256: HASH,
        packageLockSha256: HASH,
        runtimeIdentitySha256: HASH,
        version: "0.145.0",
      },
      fixtureRoot: "/tmp/c6-runtime-fixture",
      imageReference: `sha256:${IMAGE_SHA256}`,
      outputRoot: "/tmp/c6-runtime-output",
      runtimeIdentityPath: "/tmp/c6-runtime-identity.json",
      tarballRoot: "/tmp/c6-runtime-tarballs",
    });
  });

  it("rejects incomplete, duplicate, unknown, and unpinned options", () => {
    expect(() =>
      parseC6CodexRuntimeLinuxMaterializerCliOptions(
        requiredArgs().slice(1),
      )
    ).toThrow("required exactly once");
    expect(() =>
      parseC6CodexRuntimeLinuxMaterializerCliOptions([
        ...requiredArgs(),
        `--capture-sha256=${HASH}`,
      ])
    ).toThrow("cannot be specified more than once");
    expect(() =>
      parseC6CodexRuntimeLinuxMaterializerCliOptions([
        ...requiredArgs(),
        "--surprise=value",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6CodexRuntimeLinuxMaterializerCliOptions(
        requiredArgs().map((argument) =>
          argument.startsWith("--image=")
            ? `--image=sha256:${HASH}`
            : argument
        ),
      )
    ).toThrow("must equal");
    expect(() =>
      parseC6CodexRuntimeLinuxMaterializerCliOptions(
        requiredArgs().map((argument) =>
          argument.startsWith("--docker-host=")
            ? "--docker-host=tcp://attacker.invalid:2376"
            : argument
        ),
      )
    ).toThrow("explicit Unix socket");
  });
});

function requiredArgs(): string[] {
  return [
    "--container-user=501:20",
    `--capture-sha256=${HASH}`,
    "--docker-cli=/opt/docker/bin/docker",
    `--docker-cli-sha256=${HASH}`,
    "--docker-host=unix:///var/run/docker.sock",
    "--fixture-root=/tmp/c6-runtime-fixture",
    `--image=sha256:${IMAGE_SHA256}`,
    `--image-sha256=${IMAGE_SHA256}`,
    `--linux-tarball-sha256=${HASH}`,
    `--main-tarball-sha256=${HASH}`,
    "--output=/tmp/c6-runtime-output",
    `--package-json-sha256=${HASH}`,
    `--package-lock-sha256=${HASH}`,
    "--runtime-identity=/tmp/c6-runtime-identity.json",
    `--runtime-identity-sha256=${HASH}`,
    "--tarball-root=/tmp/c6-runtime-tarballs",
    "--version=0.145.0",
  ];
}
