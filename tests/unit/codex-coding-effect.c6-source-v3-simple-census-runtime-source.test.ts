import { describe, expect, it } from "bun:test";

import {
  captureC6SourceV3SimpleCensusRuntimeSource,
  parseC6SourceV3SimpleCensusRuntimeSourceManifest,
  serializeC6SourceV3SimpleCensusRuntimeSourceManifest,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-runtime-source";

describe("C6 source-v3-simple census runtime source closure", () => {
  it("captures the complete local import closure and runtime configuration", async () => {
    const manifest =
      await captureC6SourceV3SimpleCensusRuntimeSource(
        process.cwd(),
      );
    const paths = manifest.files.map(
      (file) => file.path,
    );

    expect(manifest.files).toHaveLength(45);
    expect(
      manifest.files.every(
        (file) => file.gitMode === "100644",
      ),
    ).toBe(true);
    expect(paths).toContain("package.json");
    expect(paths).toContain("bun.lock");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain(
      "scripts/codex-coding-effect/" +
      "c6-source-v3-simple-census-runner.ts",
    );
    expect(paths).toContain(
      "scripts/codex-coding-effect/" +
      "c6-source-v3-simple-census-errors.ts",
    );
    expect(paths).toContain(
      "scripts/codex-coding-effect/" +
      "c6-source-v3-simple-promotion.ts",
    );
    expect(paths).toContain(
      "scripts/codex-coding-effect/" +
      "c6-live-multilang-neighbor-deep-evidence.ts",
    );
    expect(
      parseC6SourceV3SimpleCensusRuntimeSourceManifest(
        serializeC6SourceV3SimpleCensusRuntimeSourceManifest(
          manifest,
        ),
      ),
    ).toEqual(manifest);
    expect(() =>
      parseC6SourceV3SimpleCensusRuntimeSourceManifest(
        `${JSON.stringify({
          ...manifest,
          files: manifest.files.map((file, index) =>
            index === 0
              ? {
                  ...file,
                  gitMode: "100755",
                }
              : file
          ),
        }, null, 2)}\n`,
      )
    ).toThrow();
  });
});
