import { describe, expect, it } from "bun:test";

import {
  parseC6InstalledHostPlacementLinuxCliOptions,
  runC6InstalledHostPlacementLinuxCommand,
} from "../../scripts/materialize-codex-coding-effect-c6-installed-host-placement-linux";
import type {
  C6InstalledHostPlacementLinuxInput,
} from "../../scripts/codex-coding-effect/c6-installed-host-placement-linux";

describe("C6 installed-host placement Linux CLI", () => {
  it("maps the exact four-path closure into the materializer", async () => {
    const args = requiredArgs();
    expect(parseC6InstalledHostPlacementLinuxCliOptions(args)).toEqual({
      closureRoot: "/frozen/goodmemory-closure",
      codexFixtureRoot: "/frozen/codex-fixture",
      codexTarballRoot: "/frozen/codex-tarballs",
      outputPath: "/evidence/placement.json",
    });

    let dispatched: C6InstalledHostPlacementLinuxInput | undefined;
    const result = await runC6InstalledHostPlacementLinuxCommand(
      args,
      async (input) => {
        dispatched = input;
        return { status: "dispatched" };
      },
    );
    expect(result).toEqual({ status: "dispatched" });
    expect(dispatched).toEqual({
      closureRoot: "/frozen/goodmemory-closure",
      codexFixtureRoot: "/frozen/codex-fixture",
      codexTarballRoot: "/frozen/codex-tarballs",
      outputPath: "/evidence/placement.json",
    });
  });

  it("rejects incomplete, duplicate, unknown, padded, and relative options", () => {
    expect(() =>
      parseC6InstalledHostPlacementLinuxCliOptions(
        requiredArgs().slice(1),
      )
    ).toThrow("required exactly once");
    expect(() =>
      parseC6InstalledHostPlacementLinuxCliOptions([
        ...requiredArgs(),
        "--output=/other.json",
      ])
    ).toThrow("cannot be specified more than once");
    expect(() =>
      parseC6InstalledHostPlacementLinuxCliOptions([
        ...requiredArgs(),
        "--surprise=value",
      ])
    ).toThrow("unknown");
    expect(() =>
      parseC6InstalledHostPlacementLinuxCliOptions(
        requiredArgs().map((argument) =>
          argument.startsWith("--output=")
            ? "--output= /evidence/placement.json"
            : argument
        ),
      )
    ).toThrow("padded");
    expect(() =>
      parseC6InstalledHostPlacementLinuxCliOptions(
        requiredArgs().map((argument) =>
          argument.startsWith("--closure-root=")
            ? "--closure-root=relative/closure"
            : argument
        ),
      )
    ).toThrow("absolute");
  });
});

function requiredArgs(): string[] {
  return [
    "--closure-root=/frozen/goodmemory-closure",
    "--codex-fixture-root=/frozen/codex-fixture",
    "--codex-tarball-root=/frozen/codex-tarballs",
    "--output=/evidence/placement.json",
  ];
}
