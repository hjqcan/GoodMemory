import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateC6CodexRuntimeDocuments,
  validateC6CodexRuntimeStaticClosure,
} from "../../scripts/codex-coding-effect/c6-codex-runtime";

const MAIN_BYTES = Buffer.from("main-codex-package");
const LINUX_BYTES = Buffer.from("linux-x64-codex-package");
const MAIN_INTEGRITY = sha512Integrity(MAIN_BYTES);
const LINUX_INTEGRITY = sha512Integrity(LINUX_BYTES);
const PLATFORM_PACKAGES = [
  { cpu: "arm64", os: "darwin", suffix: "darwin-arm64" },
  { cpu: "x64", os: "darwin", suffix: "darwin-x64" },
  { cpu: "arm64", os: "linux", suffix: "linux-arm64" },
  { cpu: "x64", os: "linux", suffix: "linux-x64" },
  { cpu: "arm64", os: "win32", suffix: "win32-arm64" },
  { cpu: "x64", os: "win32", suffix: "win32-x64" },
] as const;

describe("Codex coding-effect C6 Codex runtime closure", () => {
  it("cross-binds the exact Codex package, Linux optional package, and lock", () => {
    const documents = fixtureDocuments();

    expect(validateC6CodexRuntimeDocuments({
      capture: documents.capture,
      expectedVersion: "0.145.0",
      lock: documents.lock,
      packageJson: documents.packageJson,
    })).toEqual({
      codexVersion: "0.145.0",
      linuxPackageVersion: "0.145.0-linux-x64",
      packageAliases: [
        "@openai/codex",
        "@openai/codex-linux-x64",
      ],
    });

    const drifted = structuredClone(documents.lock);
    drifted.packages["node_modules/@openai/codex"].optionalDependencies[
      "@openai/codex-linux-x64"
    ] = "npm:@openai/codex@0.145.1-linux-x64";
    expect(() => validateC6CodexRuntimeDocuments({
      capture: documents.capture,
      expectedVersion: "0.145.0",
      lock: drifted,
      packageJson: documents.packageJson,
    })).toThrow("Linux x64 optional dependency");
  });

  it("validates external tarball bytes without promoting them to Linux execution proof", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-codex-runtime-",
    ));
    const fixtureRoot = join(root, "fixture");
    const tarballRoot = join(root, "tarballs");
    try {
      await mkdir(fixtureRoot);
      await mkdir(tarballRoot);
      const documents = fixtureDocuments();
      const packageJsonBytes = canonicalJson(documents.packageJson);
      const lockBytes = canonicalJson(documents.lock);
      documents.capture.packageLockSha256 = sha256(lockBytes);
      const captureBytes = canonicalJson(documents.capture);
      await Promise.all([
        writeFile(join(fixtureRoot, "package.json"), packageJsonBytes),
        writeFile(join(fixtureRoot, "package-lock.json"), lockBytes),
        writeFile(
          join(fixtureRoot, "registry-capture.json"),
          captureBytes,
        ),
        writeFile(
          join(tarballRoot, "openai-codex-0.145.0.tgz"),
          MAIN_BYTES,
        ),
        writeFile(
          join(
            tarballRoot,
            "openai-codex-0.145.0-linux-x64.tgz",
          ),
          LINUX_BYTES,
        ),
      ]);

      const result = await validateC6CodexRuntimeStaticClosure({
        expected: {
          captureSha256: sha256(captureBytes),
          linuxTarballSha256: sha256(LINUX_BYTES),
          packageJsonSha256: sha256(packageJsonBytes),
          packageLockSha256: sha256(lockBytes),
          mainTarballSha256: sha256(MAIN_BYTES),
          version: "0.145.0",
        },
        fixtureRoot,
        tarballRoot,
      });

      expect(result).toMatchObject({
        codexRunReady: false,
        linuxOfflineInstallProven: false,
        staticClosureValidated: true,
        tarballCount: 2,
      });

      await writeFile(
        join(tarballRoot, "openai-codex-0.145.0.tgz"),
        "mutated",
      );
      await expect(validateC6CodexRuntimeStaticClosure({
        expected: {
          captureSha256: sha256(captureBytes),
          linuxTarballSha256: sha256(LINUX_BYTES),
          packageJsonSha256: sha256(packageJsonBytes),
          packageLockSha256: sha256(lockBytes),
          mainTarballSha256: sha256(MAIN_BYTES),
          version: "0.145.0",
        },
        fixtureRoot,
        tarballRoot,
      })).rejects.toThrow("tarball");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects extra tarballs and symlinked roots", async () => {
    const root = await mkdtemp(join(
      await realpath(tmpdir()),
      "goodmemory-c6-codex-roots-",
    ));
    const fixtureRoot = join(root, "fixture");
    const tarballRoot = join(root, "tarballs");
    try {
      await mkdir(fixtureRoot);
      await mkdir(tarballRoot);
      const documents = fixtureDocuments();
      const packageJsonBytes = canonicalJson(documents.packageJson);
      const lockBytes = canonicalJson(documents.lock);
      documents.capture.packageLockSha256 = sha256(lockBytes);
      const captureBytes = canonicalJson(documents.capture);
      await Promise.all([
        writeFile(join(fixtureRoot, "package.json"), packageJsonBytes),
        writeFile(join(fixtureRoot, "package-lock.json"), lockBytes),
        writeFile(
          join(fixtureRoot, "registry-capture.json"),
          captureBytes,
        ),
        writeFile(
          join(tarballRoot, "openai-codex-0.145.0.tgz"),
          MAIN_BYTES,
        ),
        writeFile(
          join(
            tarballRoot,
            "openai-codex-0.145.0-linux-x64.tgz",
          ),
          LINUX_BYTES,
        ),
        writeFile(join(tarballRoot, "extra.tgz"), "extra"),
      ]);
      const expected = {
        captureSha256: sha256(captureBytes),
        linuxTarballSha256: sha256(LINUX_BYTES),
        packageJsonSha256: sha256(packageJsonBytes),
        packageLockSha256: sha256(lockBytes),
        mainTarballSha256: sha256(MAIN_BYTES),
        version: "0.145.0",
      };

      await expect(validateC6CodexRuntimeStaticClosure({
        expected,
        fixtureRoot,
        tarballRoot,
      })).rejects.toThrow("exactly 2");

      await rm(join(tarballRoot, "extra.tgz"));
      const linkedRoot = join(root, "linked-tarballs");
      await symlink(tarballRoot, linkedRoot);
      await expect(validateC6CodexRuntimeStaticClosure({
        expected,
        fixtureRoot,
        tarballRoot: linkedRoot,
      })).rejects.toThrow("symlink path component");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function fixtureDocuments() {
  const mainUrl =
    "https://registry.npmjs.org/@openai/codex/-/codex-0.145.0.tgz";
  const linuxUrl =
    "https://registry.npmjs.org/@openai/codex/-/codex-0.145.0-linux-x64.tgz";
  return {
    capture: {
      capturedAt: "2026-07-25T17:13:47Z",
      captureBoundary:
        "npm-registry-metadata-and-tarball-bytes-no-independent-registry-receipt",
      packageLockSha256: "0".repeat(64),
      packages: [
        {
          alias: "@openai/codex",
          attestationUrl:
            "https://registry.npmjs.org/-/npm/v1/attestations/@openai%2fcodex@0.145.0",
          byteLength: MAIN_BYTES.byteLength,
          filename: "openai-codex-0.145.0.tgz",
          integrity: MAIN_INTEGRITY,
          name: "@openai/codex",
          npmShasum: sha1(MAIN_BYTES),
          sha256: sha256(MAIN_BYTES),
          tarballUrl: mainUrl,
          version: "0.145.0",
        },
        {
          alias: "@openai/codex-linux-x64",
          attestationUrl:
            "https://registry.npmjs.org/-/npm/v1/attestations/@openai%2fcodex@0.145.0-linux-x64",
          byteLength: LINUX_BYTES.byteLength,
          filename: "openai-codex-0.145.0-linux-x64.tgz",
          integrity: LINUX_INTEGRITY,
          name: "@openai/codex",
          npmShasum: sha1(LINUX_BYTES),
          sha256: sha256(LINUX_BYTES),
          tarballUrl: linuxUrl,
          version: "0.145.0-linux-x64",
        },
      ],
      schemaVersion: 1,
    },
    lock: {
      lockfileVersion: 3,
      name: "goodmemory-c6-codex-runtime",
      packages: {
        "": {
          dependencies: {
            "@openai/codex": "0.145.0",
          },
          name: "goodmemory-c6-codex-runtime",
          version: "1.0.0",
        },
        "node_modules/@openai/codex": {
          integrity: MAIN_INTEGRITY,
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
              ? LINUX_INTEGRITY
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
    },
    packageJson: {
      dependencies: {
        "@openai/codex": "0.145.0",
      },
      name: "goodmemory-c6-codex-runtime",
      private: true,
      version: "1.0.0",
    },
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha1(value: Uint8Array): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha512Integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}
