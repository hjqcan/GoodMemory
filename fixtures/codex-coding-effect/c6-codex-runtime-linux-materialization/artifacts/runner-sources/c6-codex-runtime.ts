import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
} from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sha1Schema = z.string().regex(/^[a-f0-9]{40}$/u);
const integritySchema = z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const packageJsonSchema = z.object({
  dependencies: z.object({
    "@openai/codex": z.string().min(1),
  }).strict(),
  name: z.literal("goodmemory-c6-codex-runtime"),
  private: z.literal(true),
  version: z.literal("1.0.0"),
}).strict();
const lockSchema = z.object({
  lockfileVersion: z.literal(3),
  name: z.literal("goodmemory-c6-codex-runtime"),
  packages: z.record(z.string(), z.unknown()),
  requires: z.literal(true),
  version: z.literal("1.0.0"),
}).strict();
const capturePackageSchema = z.object({
  alias: z.enum(["@openai/codex", "@openai/codex-linux-x64"]),
  attestationUrl: z.string().url(),
  byteLength: z.number().int().positive(),
  filename: z.string().regex(/^openai-codex-[A-Za-z0-9.-]+\.tgz$/u),
  integrity: integritySchema,
  name: z.literal("@openai/codex"),
  npmShasum: sha1Schema,
  sha256: sha256Schema,
  tarballUrl: z.string().url(),
  version: z.string().min(1),
}).strict();
const captureSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  captureBoundary: z.literal(
    "npm-registry-metadata-and-tarball-bytes-no-independent-registry-receipt",
  ),
  packageLockSha256: sha256Schema,
  packages: z.array(capturePackageSchema).length(2),
  schemaVersion: z.literal(1),
}).strict();
const expectedSchema = z.object({
  captureSha256: sha256Schema,
  linuxTarballSha256: sha256Schema,
  packageJsonSha256: sha256Schema,
  packageLockSha256: sha256Schema,
  mainTarballSha256: sha256Schema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
}).strict();

const MAIN_ALIAS = "@openai/codex";
const LINUX_ALIAS = "@openai/codex-linux-x64";
const PLATFORM_PACKAGES = [
  { cpu: "arm64", os: "darwin", suffix: "darwin-arm64" },
  { cpu: "x64", os: "darwin", suffix: "darwin-x64" },
  { cpu: "arm64", os: "linux", suffix: "linux-arm64" },
  { cpu: "x64", os: "linux", suffix: "linux-x64" },
  { cpu: "arm64", os: "win32", suffix: "win32-arm64" },
  { cpu: "x64", os: "win32", suffix: "win32-x64" },
] as const;
const FIXTURE_FILES = [
  "package-lock.json",
  "package.json",
  "registry-capture.json",
] as const;

export interface C6CodexRuntimeDocumentIdentity {
  codexVersion: string;
  linuxPackageVersion: string;
  packageAliases: [typeof MAIN_ALIAS, typeof LINUX_ALIAS];
}

export interface C6CodexRuntimeStaticClosure {
  captureSha256: string;
  codexRunReady: false;
  codexVersion: string;
  linuxOfflineInstallProven: false;
  linuxTarballSha256: string;
  mainTarballSha256: string;
  packageJsonSha256: string;
  packageLockSha256: string;
  staticClosureValidated: true;
  tarballCount: 2;
}

export function validateC6CodexRuntimeDocuments(input: {
  capture: unknown;
  expectedVersion: string;
  lock: unknown;
  packageJson: unknown;
}): C6CodexRuntimeDocumentIdentity {
  const packageJson = packageJsonSchema.parse(input.packageJson);
  const lock = lockSchema.parse(input.lock);
  const capture = captureSchema.parse(input.capture);
  if (packageJson.dependencies[MAIN_ALIAS] !== input.expectedVersion) {
    throw new Error("C6 Codex package.json version does not match");
  }

  const root = parseRecord(lock.packages[""], "C6 Codex lock root");
  const rootDependencies = parseRecord(
    root.dependencies,
    "C6 Codex lock root dependencies",
  );
  if (
    root.name !== packageJson.name ||
    root.version !== packageJson.version ||
    Object.keys(rootDependencies).length !== 1 ||
    rootDependencies[MAIN_ALIAS] !== input.expectedVersion
  ) {
    throw new Error("C6 Codex package-lock root does not match package.json");
  }

  const captureByAlias = new Map(
    capture.packages.map((entry) => [entry.alias, entry]),
  );
  if (
    captureByAlias.size !== 2 ||
    capture.packages[0]?.alias !== MAIN_ALIAS ||
    capture.packages[1]?.alias !== LINUX_ALIAS
  ) {
    throw new Error("C6 Codex registry capture order or aliases drifted");
  }
  const mainCapture = captureByAlias.get(MAIN_ALIAS)!;
  const linuxCapture = captureByAlias.get(LINUX_ALIAS)!;
  const linuxVersion = `${input.expectedVersion}-linux-x64`;
  if (
    mainCapture.version !== input.expectedVersion ||
    linuxCapture.version !== linuxVersion ||
    mainCapture.filename !==
      `openai-codex-${input.expectedVersion}.tgz` ||
    linuxCapture.filename !==
      `openai-codex-${linuxVersion}.tgz`
  ) {
    throw new Error("C6 Codex registry capture version drifted");
  }

  const main = parseRecord(
    lock.packages[`node_modules/${MAIN_ALIAS}`],
    "C6 Codex main lock entry",
  );
  const linux = parseRecord(
    lock.packages[`node_modules/${LINUX_ALIAS}`],
    "C6 Codex Linux x64 lock entry",
  );
  const optionalDependencies = parseRecord(
    main.optionalDependencies,
    "C6 Codex optional dependencies",
  );
  const expectedOptionalDependencies = Object.fromEntries(
    PLATFORM_PACKAGES.map(({ suffix }) => [
      `@openai/codex-${suffix}`,
      `npm:@openai/codex@${input.expectedVersion}-${suffix}`,
    ]),
  );
  if (
    main.version !== input.expectedVersion ||
    main.resolved !== mainCapture.tarballUrl ||
    main.integrity !== mainCapture.integrity
  ) {
    throw new Error("C6 Codex main package lock identity drifted");
  }
  if (
    optionalDependencies[LINUX_ALIAS] !==
      `npm:@openai/codex@${linuxVersion}`
  ) {
    throw new Error("C6 Codex Linux x64 optional dependency drifted");
  }
  if (
    JSON.stringify(optionalDependencies) !==
      JSON.stringify(expectedOptionalDependencies)
  ) {
    throw new Error("C6 Codex optional dependency closure drifted");
  }
  if (
    linux.name !== MAIN_ALIAS ||
    linux.version !== linuxVersion ||
    linux.resolved !== linuxCapture.tarballUrl ||
    linux.integrity !== linuxCapture.integrity ||
    linux.optional !== true ||
    !sameStrings(linux.cpu, ["x64"]) ||
    !sameStrings(linux.os, ["linux"])
  ) {
    throw new Error("C6 Codex Linux x64 package lock identity drifted");
  }
  const expectedLockKeys = [
    "",
    `node_modules/${MAIN_ALIAS}`,
    ...PLATFORM_PACKAGES.map(
      ({ suffix }) => `node_modules/@openai/codex-${suffix}`,
    ),
  ].sort();
  if (!sameStrings(Object.keys(lock.packages), expectedLockKeys)) {
    throw new Error("C6 Codex package-lock closure contains unexpected entries");
  }
  for (const { cpu, os, suffix } of PLATFORM_PACKAGES) {
    const entry = parseRecord(
      lock.packages[`node_modules/@openai/codex-${suffix}`],
      `C6 Codex ${suffix} lock entry`,
    );
    if (
      entry.name !== MAIN_ALIAS ||
      entry.version !== `${input.expectedVersion}-${suffix}` ||
      entry.resolved !==
        `https://registry.npmjs.org/@openai/codex/-/codex-${
          input.expectedVersion
        }-${suffix}.tgz` ||
      typeof entry.integrity !== "string" ||
      !integritySchema.safeParse(entry.integrity).success ||
      entry.optional !== true ||
      !sameStrings(entry.cpu, [cpu]) ||
      !sameStrings(entry.os, [os])
    ) {
      throw new Error(`C6 Codex ${suffix} package lock identity drifted`);
    }
  }

  return {
    codexVersion: input.expectedVersion,
    linuxPackageVersion: linuxVersion,
    packageAliases: [MAIN_ALIAS, LINUX_ALIAS],
  };
}

export async function validateC6CodexRuntimeStaticClosure(input: {
  expected: {
    captureSha256: string;
    linuxTarballSha256: string;
    packageJsonSha256: string;
    packageLockSha256: string;
    mainTarballSha256: string;
    version: string;
  };
  fixtureRoot: string;
  tarballRoot: string;
}): Promise<C6CodexRuntimeStaticClosure> {
  const expected = expectedSchema.parse(input.expected);
  const fixtureRoot = await canonicalDirectory(
    input.fixtureRoot,
    "C6 Codex fixture root",
  );
  const tarballRoot = await canonicalDirectory(
    input.tarballRoot,
    "C6 Codex tarball root",
  );
  await assertExactFiles(fixtureRoot, FIXTURE_FILES, "fixture");

  const [packageJsonBytes, lockBytes, captureBytes] = await Promise.all([
    readC6StableRegularFile(
      join(fixtureRoot, "package.json"),
      "Codex package.json",
    ),
    readC6StableRegularFile(
      join(fixtureRoot, "package-lock.json"),
      "Codex package-lock",
    ),
    readC6StableRegularFile(
      join(fixtureRoot, "registry-capture.json"),
      "Codex registry capture",
    ),
  ]);
  assertHash(packageJsonBytes, expected.packageJsonSha256, "package.json");
  assertHash(lockBytes, expected.packageLockSha256, "package-lock");
  assertHash(captureBytes, expected.captureSha256, "registry capture");

  const packageJson = parseJson(
    packageJsonSchema,
    packageJsonBytes,
    "C6 Codex package.json",
  );
  const lock = parseJson(
    lockSchema,
    lockBytes,
    "C6 Codex package-lock",
  );
  const capture = parseJson(
    captureSchema,
    captureBytes,
    "C6 Codex registry capture",
    true,
  );
  if (capture.packageLockSha256 !== expected.packageLockSha256) {
    throw new Error("C6 Codex registry capture package-lock hash drifted");
  }
  const identity = validateC6CodexRuntimeDocuments({
    capture,
    expectedVersion: expected.version,
    lock,
    packageJson,
  });

  const filenames = capture.packages.map((entry) => entry.filename).sort();
  await assertExactFiles(tarballRoot, filenames, "tarball");
  for (const entry of capture.packages) {
    const bytes = await readC6StableRegularFile(
      join(tarballRoot, entry.filename),
      `Codex tarball ${entry.alias}`,
    );
    const expectedSha256 = entry.alias === MAIN_ALIAS
      ? expected.mainTarballSha256
      : expected.linuxTarballSha256;
    if (
      bytes.byteLength !== entry.byteLength ||
      entry.sha256 !== expectedSha256 ||
      sha256(bytes) !== expectedSha256 ||
      sha1(bytes) !== entry.npmShasum ||
      sha512Integrity(bytes) !== entry.integrity
    ) {
      throw new Error(`C6 Codex tarball ${entry.alias} identity drifted`);
    }
  }

  await Promise.all([
    assertC6NoSymlinkPathComponents(
      fixtureRoot,
      "C6 Codex fixture root terminal check",
    ),
    assertC6NoSymlinkPathComponents(
      tarballRoot,
      "C6 Codex tarball root terminal check",
    ),
  ]);
  const terminal = await Promise.all([
    readC6StableRegularFile(
      join(fixtureRoot, "package.json"),
      "Codex package.json terminal check",
    ),
    readC6StableRegularFile(
      join(fixtureRoot, "package-lock.json"),
      "Codex package-lock terminal check",
    ),
    readC6StableRegularFile(
      join(fixtureRoot, "registry-capture.json"),
      "Codex registry capture terminal check",
    ),
  ]);
  if (
    sha256(terminal[0]) !== expected.packageJsonSha256 ||
    sha256(terminal[1]) !== expected.packageLockSha256 ||
    sha256(terminal[2]) !== expected.captureSha256
  ) {
    throw new Error("C6 Codex static closure changed during validation");
  }

  return {
    captureSha256: expected.captureSha256,
    codexRunReady: false,
    codexVersion: identity.codexVersion,
    linuxOfflineInstallProven: false,
    linuxTarballSha256: expected.linuxTarballSha256,
    mainTarballSha256: expected.mainTarballSha256,
    packageJsonSha256: expected.packageJsonSha256,
    packageLockSha256: expected.packageLockSha256,
    staticClosureValidated: true,
    tarballCount: 2,
  };
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  await assertC6NoSymlinkPathComponents(resolved, label);
  if (!(await lstat(resolved)).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

async function assertExactFiles(
  root: string,
  expected: readonly string[],
  label: string,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  if (
    entries.some((entry) => !entry.isFile()) ||
    !sameStrings(entries.map((entry) => entry.name), expected)
  ) {
    throw new Error(`C6 Codex ${label} closure must contain exactly ${
      expected.length
    } regular files`);
  }
}

function parseJson<T>(
  schema: z.ZodType<T>,
  bytes: Buffer,
  label: string,
  requireCanonical = false,
): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const parsed = schema.parse(value);
  if (
    requireCanonical &&
    `${JSON.stringify(parsed, null, 2)}\n` !== bytes.toString("utf8")
  ) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return parsed;
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === "string") &&
    JSON.stringify([...value].sort()) ===
      JSON.stringify([...expected].sort());
}

function assertHash(
  bytes: Uint8Array,
  expected: string,
  label: string,
): void {
  if (sha256(bytes) !== expected) {
    throw new Error(`C6 Codex ${label} hash drifted`);
  }
}

function sha1(value: Uint8Array): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}
